-- Skjema for Eventyrboka. Kjør hele filen i Supabase -> SQL Editor.
-- Trygg å kjøre flere ganger: alt er IF NOT EXISTS.

-- Brukere. Én rad per innlogget Vipps-bruker.
create table if not exists public.brukere (
  vipps_sub        text primary key,
  fornavn          text,
  siste_innlogging timestamptz not null default now(),
  opprettet        timestamptz not null default now()
);

-- Fortellinger. Én rad per lagret historie, med hele historien som JSONB
-- (inkludert bildene i base64). Vi stoler på id-en fra klienten (uuid),
-- men nøkler alltid mot vipps_sub, så ingen kan skrive til en annens rad.
create table if not exists public.fortellinger (
  id         text primary key,
  vipps_sub  text not null references public.brukere(vipps_sub) on delete cascade,
  data       jsonb not null,
  opprettet  timestamptz not null default now(),
  oppdatert  timestamptz not null default now()
);

create index if not exists fortellinger_vipps_sub_idx
  on public.fortellinger (vipps_sub, opprettet desc);

-- Row-level security slås på, men vi lager ingen policies: appen bruker
-- service-nøkkelen fra serveren, og sesjonen vår bestemmer hvilken
-- vipps_sub vi snakker om. Ingen anon- eller authenticated-rolle slipper til.
alter table public.brukere       enable row level security;
alter table public.fortellinger  enable row level security;

-- Valg brukeren vil ha husket på oppsett-siden (alder, lengde og tegnestil).
alter table public.brukere
  add column if not exists innstillinger jsonb not null default '{}'::jsonb;

-- Kostnadstak mot Gemini (se api/_lib/budget.ts). Én rad per dag og teller:
--   alle:story / alle:image / alle:text / alle:speech  -> alle besøkende samlet
--   ip:<hash>:story osv.                                -> én besøkende (hashet IP)
-- Vil du se forbruket:  select * from forbruk where nokkel like 'alle:%' order by dag desc;
create table if not exists public.forbruk (
  dag    date    not null,
  nokkel text    not null,
  antall integer not null default 0,
  primary key (dag, nokkel)
);
alter table public.forbruk enable row level security;

-- Tar én plass i begge tellerne hvis det er ledig i begge, og svarer
-- 'ok', 'alle' (dagens felles tak er nådd) eller 'ip' (denne besøkende har
-- brukt opp sitt). Dagen skifter ved midnatt norsk tid.
create or replace function public.tell_forbruk(
  p_ip_nokkel   text,
  p_ip_grense   integer,
  p_alle_nokkel text,
  p_alle_grense integer
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_dag    date := (now() at time zone 'Europe/Oslo')::date;
  v_antall integer;
begin
  if p_alle_grense < 1 then return 'alle'; end if;
  if p_ip_grense   < 1 then return 'ip';   end if;

  insert into forbruk (dag, nokkel, antall) values (v_dag, p_alle_nokkel, 1)
  on conflict (dag, nokkel) do update set antall = forbruk.antall + 1
    where forbruk.antall < p_alle_grense
  returning antall into v_antall;
  if v_antall is null then return 'alle'; end if;

  -- Dagens første: rydd. Besøkende-tellere slettes etter ett døgn,
  -- fellestellerne beholdes i 90 dager som historikk.
  if v_antall = 1 then
    delete from forbruk where nokkel like 'ip:%' and dag < v_dag - 1;
    delete from forbruk where dag < v_dag - 90;
  end if;

  v_antall := null;
  insert into forbruk (dag, nokkel, antall) values (v_dag, p_ip_nokkel, 1)
  on conflict (dag, nokkel) do update set antall = forbruk.antall + 1
    where forbruk.antall < p_ip_grense
  returning antall into v_antall;
  if v_antall is null then
    -- Den besøkende har brukt opp sitt: gi fellesplassen tilbake.
    update forbruk set antall = antall - 1 where dag = v_dag and nokkel = p_alle_nokkel;
    return 'ip';
  end if;

  return 'ok';
end;
$$;

-- Bare serveren (service-nøkkelen) får kalle funksjonen.
revoke all on function public.tell_forbruk(text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.tell_forbruk(text, integer, text, integer) to service_role;

-- Gratis eller Pro. NULL betyr at brukeren ikke har valgt ennå (da vises
-- valgsiden etter innlogging). Settes bare av serveren (api/meg.ts).
alter table public.brukere
  add column if not exists plan text;

-- Ukeskvoten for gratisbrukere (se api/_lib/access.ts). Bruker samme tabell
-- som kostnadstaket: én rad per uke og bruker, med mandagen (norsk tid) som dag.
create or replace function public.bruk_ukeskvote(p_nokkel text, p_grense integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_uke    date := date_trunc('week', now() at time zone 'Europe/Oslo')::date;
  v_antall integer;
begin
  if p_grense < 1 then return false; end if;
  insert into forbruk (dag, nokkel, antall) values (v_uke, p_nokkel, 1)
  on conflict (dag, nokkel) do update set antall = forbruk.antall + 1
    where forbruk.antall < p_grense
  returning antall into v_antall;
  return v_antall is not null;
end;
$$;

-- Hvor mange eventyr brukeren har laget denne uka.
create or replace function public.les_ukeskvote(p_nokkel text)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select antall from forbruk
      where dag = date_trunc('week', now() at time zone 'Europe/Oslo')::date
        and nokkel = p_nokkel),
    0);
$$;

revoke all on function public.bruk_ukeskvote(text, integer) from public, anon, authenticated;
revoke all on function public.les_ukeskvote(text) from public, anon, authenticated;
grant execute on function public.bruk_ukeskvote(text, integer) to service_role;
grant execute on function public.les_ukeskvote(text) to service_role;

-- Betaling med Vipps (se api/_lib/betaling.ts).
--
-- Kjøp av enkelthistorier. Én rad per kjøp; referanse er den samme som hos
-- Vipps. Et betalt kjøp som ikke er brukt, er en historie brukeren har til gode.
--   status: opprettet (sendt til Vipps) | betalt | avbrutt
--   type:   historie | din-historie
create table if not exists public.kjop (
  referanse  text primary key,
  vipps_sub  text not null references public.brukere(vipps_sub) on delete cascade,
  type       text not null,
  belop      integer not null,            -- i øre
  status     text not null default 'opprettet',
  brukt      timestamptz,
  betalt     timestamptz,
  opprettet  timestamptz not null default now()
);
create index if not exists kjop_bruker_idx on public.kjop (vipps_sub, status);
alter table public.kjop enable row level security;

-- Prinsen-abonnement. Én rad per avtale hos Vipps.
--   status:    venter (ikke godkjent ennå) | aktiv | stoppet (sagt opp, varer
--              ut betalt tid) | avsluttet
--   betalt_til: dagen neste uke begynner, og neste trekk forfaller
--   trekk_id / trekk_forfall: trekket som er bestilt hos Vipps, om noe
create table if not exists public.avtaler (
  avtale_id     text primary key,
  referanse     text not null unique,     -- vår egen, står i adressen tilbake fra Vipps
  vipps_sub     text not null references public.brukere(vipps_sub) on delete cascade,
  status        text not null default 'venter',
  betalt_til    date,
  trekk_id      text,
  trekk_forfall date,
  opprettet     timestamptz not null default now(),
  oppdatert     timestamptz not null default now()
);
create index if not exists avtaler_bruker_idx on public.avtaler (vipps_sub, opprettet desc);
alter table public.avtaler enable row level security;

-- Bruker én kjøpt historie av typen, den eldste først. Svarer med
-- referansen, eller NULL når brukeren ikke har noen til gode.
create or replace function public.bruk_kjop(p_sub text, p_type text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_ref text;
begin
  update kjop set brukt = now()
   where referanse = (
     select referanse from kjop
      where vipps_sub = p_sub and type = p_type
        and status = 'betalt' and brukt is null
      order by opprettet
      limit 1
      for update skip locked)
  returning referanse into v_ref;
  return v_ref;
end;
$$;

revoke all on function public.bruk_kjop(text, text) from public, anon, authenticated;
grant execute on function public.bruk_kjop(text, text) to service_role;

-- Innsikt. Én rad per historie som blir startet (se services/insight.ts og
-- api/innsikt.ts). Raden handler om historien, ikke om leseren: ingen
-- vipps_sub, ingen IP, og aldri noe brukeren har skrevet selv (egen
-- lærepenge står som «Egen»).
--   type:  vanlig | magi            hvem: gjest | askeladden | prinsen
--   sider: siden leseren kom lengst til (1 = bare åpningen)
--   valg:  hva som ble valgt på hver side, f.eks. «0,1,0» (-1 = avsluttet av voksen)
create table if not exists public.innsikt (
  id               uuid primary key,
  startet          timestamptz not null default now(),
  oppdatert        timestamptz not null default now(),
  helt             text,
  moral            text,
  alder            text,
  stil             text,
  lengde           text,
  type             text,
  hvem             text,
  enhet            text,
  kjopt            boolean not null default false,
  logget_inn       boolean not null default false,   -- gjest som logget inn for å lese videre
  sider            integer not null default 1,
  ferdig           boolean not null default false,
  avsluttet_tidlig boolean not null default false,
  valg             text,
  sekunder         integer,                          -- fra start til siste livstegn
  stjerner         integer,
  lagret           boolean not null default false,
  les_hoyt         boolean not null default false
);
create index if not exists innsikt_startet_idx on public.innsikt (startet desc);
alter table public.innsikt enable row level security;

-- Mer om hver historie: hvor leseren kom fra, innloggingsveggen, ventetid og feil.
--   sider = 0:     historien kom aldri i gang (se stoppet: feil | kvote | innlogging,
--                  eller NULL når leseren gikk mens den ble laget)
--   kilde:         der leseren kom fra første gang (utm_source eller nettstedet), f.eks. facebook
--   vent_start_ms: fra «start» til side 1 var på skjermen
--   vent_sider:    ventetid i ms for hver side etter det, f.eks. «0,1200,300» (0 = lå klar)
--   bilder_manglet: sider leseren bladde forbi før bildet var kommet
alter table public.innsikt
  add column if not exists kilde          text,
  add column if not exists kampanje       text,
  add column if not exists vegg_sett      boolean not null default false,
  add column if not exists vegg_klikket   boolean not null default false,
  add column if not exists vent_start_ms  integer,
  add column if not exists vent_sider     text,
  add column if not exists bilder_manglet integer not null default 0,
  add column if not exists feil           integer not null default 0,
  add column if not exists stoppet        text;

-- Legger inn eller oppdaterer raden. Det som er kjent blir stående: sider
-- går bare oppover, og ferdig/lagret/les_hoyt blir aldri slått av igjen.
create or replace function public.logg_innsikt(p jsonb)
returns boolean
language sql
set search_path = public
as $$
  insert into innsikt as i (
    id, helt, moral, alder, stil, lengde, type, hvem, enhet, kjopt, logget_inn,
    sider, ferdig, avsluttet_tidlig, valg, sekunder, stjerner, lagret, les_hoyt,
    kilde, kampanje, vegg_sett, vegg_klikket, vent_start_ms, vent_sider,
    bilder_manglet, feil, stoppet)
  values (
    (p->>'id')::uuid, p->>'helt', p->>'moral', p->>'alder', p->>'stil', p->>'lengde',
    p->>'type', p->>'hvem', p->>'enhet',
    coalesce((p->>'kjopt')::boolean, false),
    coalesce((p->>'logget_inn')::boolean, false),
    coalesce((p->>'sider')::integer, 1),
    coalesce((p->>'ferdig')::boolean, false),
    coalesce((p->>'avsluttet_tidlig')::boolean, false),
    p->>'valg', (p->>'sekunder')::integer, (p->>'stjerner')::integer,
    coalesce((p->>'lagret')::boolean, false),
    coalesce((p->>'les_hoyt')::boolean, false),
    p->>'kilde', p->>'kampanje',
    coalesce((p->>'vegg_sett')::boolean, false),
    coalesce((p->>'vegg_klikket')::boolean, false),
    (p->>'vent_start_ms')::integer, p->>'vent_sider',
    coalesce((p->>'bilder_manglet')::integer, 0),
    coalesce((p->>'feil')::integer, 0),
    p->>'stoppet')
  on conflict (id) do update set
    oppdatert        = now(),
    helt             = coalesce(i.helt, excluded.helt),
    moral            = coalesce(i.moral, excluded.moral),
    alder            = coalesce(i.alder, excluded.alder),
    stil             = coalesce(i.stil, excluded.stil),
    lengde           = coalesce(i.lengde, excluded.lengde),
    -- Serveren kan gjøre om på disse når historien starter (gjest, kjøpt).
    type             = coalesce(excluded.type, i.type),
    hvem             = coalesce(excluded.hvem, i.hvem),
    enhet            = coalesce(i.enhet, excluded.enhet),
    kjopt            = i.kjopt or excluded.kjopt,
    logget_inn       = i.logget_inn or excluded.logget_inn,
    sider            = greatest(i.sider, coalesce((p->>'sider')::integer, 0)),
    ferdig           = i.ferdig or excluded.ferdig,
    avsluttet_tidlig = i.avsluttet_tidlig or excluded.avsluttet_tidlig,
    valg             = case when length(coalesce(excluded.valg, '')) >= length(coalesce(i.valg, ''))
                            then coalesce(excluded.valg, i.valg) else i.valg end,
    sekunder         = greatest(i.sekunder, excluded.sekunder),
    stjerner         = coalesce(excluded.stjerner, i.stjerner),
    lagret           = i.lagret or excluded.lagret,
    les_hoyt         = i.les_hoyt or excluded.les_hoyt,
    kilde            = coalesce(i.kilde, excluded.kilde),
    kampanje         = coalesce(i.kampanje, excluded.kampanje),
    vegg_sett        = i.vegg_sett or excluded.vegg_sett,
    vegg_klikket     = i.vegg_klikket or excluded.vegg_klikket,
    vent_start_ms    = coalesce(i.vent_start_ms, excluded.vent_start_ms),
    vent_sider       = case when length(coalesce(excluded.vent_sider, '')) >= length(coalesce(i.vent_sider, ''))
                            then coalesce(excluded.vent_sider, i.vent_sider) else i.vent_sider end,
    bilder_manglet   = greatest(i.bilder_manglet, excluded.bilder_manglet),
    feil             = greatest(i.feil, excluded.feil),
    stoppet          = coalesce(excluded.stoppet, i.stoppet)
  returning true;
$$;

revoke all on function public.logg_innsikt(jsonb) from public, anon, authenticated;
grant execute on function public.logg_innsikt(jsonb) to service_role;

-- Hendelser utenfor selve historien: besøk, kvoten som tar slutt, låser,
-- plansiden, kjøp og oppsigelse. Én rad per hendelse, uten noe som sier hvem
-- det var — bare hvem-typen (gjest/askeladden/prinsen) og kilden.
create table if not exists public.innsikt_hendelser (
  id       bigint generated always as identity primary key,
  tid      timestamptz not null default now(),
  navn     text not null,
  detalj   text,
  hvem     text,
  kilde    text,
  kampanje text
);
create index if not exists innsikt_hendelser_tid_idx on public.innsikt_hendelser (tid desc);
alter table public.innsikt_hendelser enable row level security;

create or replace function public.logg_hendelse(p jsonb)
returns boolean
language sql
set search_path = public
as $$
  insert into innsikt_hendelser (navn, detalj, hvem, kilde, kampanje)
  values (p->>'navn', p->>'detalj', p->>'hvem', p->>'kilde', p->>'kampanje')
  returning true;
$$;

revoke all on function public.logg_hendelse(jsonb) from public, anon, authenticated;
grant execute on function public.logg_hendelse(jsonb) to service_role;

-- Ferdige oversikter. Åpne dem i Supabase -> Table Editor, eller kjør
-- f.eks.  select * from innsikt_frafall;  i SQL Editor.

-- Hvor langt folk kommer: hvor mange historier som nådde hver side.
create or replace view public.innsikt_frafall with (security_invoker = true) as
select s.side,
       count(*) filter (where i.sider >= s.side) as historier,
       round(100.0 * count(*) filter (where i.sider >= s.side) / nullif(count(*), 0)) as prosent
  from generate_series(1, 5) as s(side)
 cross join (select * from public.innsikt where sider >= 1) i
 group by s.side
 order by s.side;

-- Hva som er mest populært, og hvordan det går med det. Én rad per verdi av
-- hvert valg (helt, lærepenge, type, hvem, alder, tegnestil, lengde, enhet, kilde).
create or replace view public.innsikt_populaert with (security_invoker = true) as
select v.hva, v.verdi,
       count(*)                                   as startet,
       count(*) filter (where i.ferdig)           as ferdig,
       round(100.0 * count(*) filter (where i.ferdig) / count(*)) as ferdig_prosent,
       round(avg(i.sider), 1)                     as snitt_sider,
       count(i.stjerner)                          as vurderinger,
       round(avg(i.stjerner), 2)                  as snitt_stjerner,
       count(*) filter (where i.lagret)           as lagret
  from public.innsikt i
 cross join lateral (values
   ('helt', i.helt), ('lærepenge', i.moral), ('type', i.type), ('hvem', i.hvem),
   ('alder', i.alder), ('tegnestil', i.stil), ('lengde', i.lengde), ('enhet', i.enhet),
   ('kilde', i.kilde)
 ) as v(hva, verdi)
 where v.verdi is not null and i.sider >= 1
 group by v.hva, v.verdi
 order by v.hva, startet desc;

-- Hvor mange stjerner folk gir.
create or replace view public.innsikt_stjerner with (security_invoker = true) as
select stjerner, count(*) as antall
  from public.innsikt
 where stjerner is not null
 group by stjerner
 order by stjerner desc;

-- Uke for uke (mandag norsk tid).
create or replace view public.innsikt_uker with (security_invoker = true) as
select date_trunc('week', startet at time zone 'Europe/Oslo')::date as uke,
       count(*) filter (where sider >= 1)                as startet,
       count(*) filter (where ferdig)                    as ferdig,
       count(*) filter (where hvem = 'gjest' and sider >= 1) as gjester,
       count(*) filter (where hvem = 'gjest' and logget_inn) as gjester_logget_inn,
       count(*) filter (where type = 'magi' and sider >= 1)  as magihistorier,
       count(*) filter (where kjopt)                     as kjopte,
       round(avg(stjerner), 2)                           as snitt_stjerner,
       round(avg(sekunder) filter (where ferdig) / 60.0, 1) as snitt_minutter_ferdig,
       count(*) filter (where sider = 0)                 as kom_aldri_i_gang,
       count(*) filter (where feil > 0)                  as historier_med_feil,
       round(avg(vent_start_ms) / 1000.0, 1)             as snitt_sek_til_side_1
  from public.innsikt
 group by 1
 order by 1 desc;

-- Ventetid: hvor lenge leseren venter på side 1 og på hver side etter det.
create or replace view public.innsikt_ventetid with (security_invoker = true) as
with vent as (
  select 1 as side, vent_start_ms as ms from public.innsikt where vent_start_ms is not null
  union all
  select t.nr::integer + 1, t.ms::integer
    from public.innsikt i
   cross join lateral unnest(string_to_array(i.vent_sider, ',')) with ordinality as t(ms, nr)
   where i.vent_sider is not null and i.vent_sider <> ''
)
select side,
       count(*)                                                        as antall,
       round(100.0 * count(*) filter (where ms < 500) / count(*))      as prosent_uten_venting,
       round((percentile_cont(0.5) within group (order by ms) / 1000.0)::numeric, 1) as median_sek,
       round((percentile_cont(0.9) within group (order by ms) / 1000.0)::numeric, 1) as p90_sek
  from vent
 group by side
 order by side;

-- Skremmer ventetiden folk bort? Ventetid på side 1 mot hvor mange som leste videre.
create or replace view public.innsikt_ventetid_frafall with (security_invoker = true) as
select case when vent_start_ms < 10000 then '1: under 10 s'
            when vent_start_ms < 20000 then '2: 10–20 s'
            when vent_start_ms < 40000 then '3: 20–40 s'
            else '4: over 40 s' end                              as ventet_pa_side_1,
       count(*)                                                  as historier,
       round(100.0 * count(*) filter (where sider >= 2) / count(*)) as leste_videre_prosent,
       round(100.0 * count(*) filter (where ferdig) / count(*))  as ferdig_prosent
  from public.innsikt
 where vent_start_ms is not null and sider >= 1
 group by 1
 order by 1;

-- Feil og bilder som ikke rakk fram.
create or replace view public.innsikt_feil with (security_invoker = true) as
select date_trunc('week', startet at time zone 'Europe/Oslo')::date as uke,
       count(*)                                           as forsok,
       count(*) filter (where stoppet = 'feil')           as oppstart_feilet,
       count(*) filter (where stoppet = 'kvote')          as stoppet_av_kvoten,
       count(*) filter (where sider = 0 and stoppet is null) as gikk_mens_den_ble_laget,
       count(*) filter (where feil > 0 and sider >= 1)    as historier_med_feil,
       count(*) filter (where feil > 0 and sider >= 1 and not ferdig) as av_dem_ikke_ferdig,
       coalesce(sum(bilder_manglet), 0)                   as sider_uten_bilde
  from public.innsikt
 group by 1
 order by 1 desc;

-- Innloggingsveggen på side 2: hvor mange gjester som kommer seg gjennom.
create or replace view public.innsikt_vegg with (security_invoker = true) as
select date_trunc('week', startet at time zone 'Europe/Oslo')::date as uke,
       count(*)                                  as gjestehistorier,
       count(*) filter (where sider >= 2)        as leste_side_2,
       count(*) filter (where vegg_sett)         as sa_veggen,
       count(*) filter (where vegg_klikket)      as klikket_vipps,
       count(*) filter (where logget_inn)        as logget_inn,
       count(*) filter (where logget_inn and sider >= 3) as leste_videre,
       count(*) filter (where logget_inn and ferdig)     as ferdig
  from public.innsikt
 where hvem = 'gjest' and sider >= 1
 group by 1
 order by 1 desc;

-- Betalingstrakten uke for uke.
create or replace view public.innsikt_kjop with (security_invoker = true) as
select date_trunc('week', tid at time zone 'Europe/Oslo')::date as uke,
       count(*) filter (where navn = 'Kvote truffet')        as kvote_truffet,
       count(*) filter (where navn = 'Lås truffet')          as las_truffet,
       count(*) filter (where navn = 'Plansiden åpnet')      as plansiden_apnet,
       count(*) filter (where navn = 'Kjøp startet')         as kjop_startet,
       count(*) filter (where navn = 'Historie kjøpt')       as kjop_fullfort,
       count(*) filter (where navn = 'Prinsen-kjøp startet') as prinsen_startet,
       count(*) filter (where navn = 'Prinsen kjøpt')        as prinsen_fullfort,
       count(*) filter (where navn = 'Kjøp avbrutt')         as avbrutt,
       count(*) filter (where navn = 'Prinsen sagt opp')     as prinsen_sagt_opp
  from public.innsikt_hendelser
 group by 1
 order by 1 desc;

-- Alle hendelser talt opp, med detaljen (f.eks. hvilken lås, hvilken type kjøp).
create or replace view public.innsikt_hendelser_telt with (security_invoker = true) as
select navn, detalj, hvem, count(*) as antall, max(tid) as sist
  from public.innsikt_hendelser
 group by navn, detalj, hvem
 order by navn, antall desc;

-- Hvor folk kommer fra, og hva de gjør: besøk, historier og kjøp per kilde.
create or replace view public.innsikt_kilder with (security_invoker = true) as
with h as (
  select coalesce(kilde, 'ukjent') as kilde,
         count(*) filter (where navn = 'Besøk')                              as besok,
         count(*) filter (where navn in ('Historie kjøpt', 'Prinsen kjøpt')) as kjop
    from public.innsikt_hendelser group by 1
), i as (
  select coalesce(kilde, 'ukjent') as kilde,
         count(*) filter (where sider >= 1) as historier,
         count(*) filter (where ferdig)     as ferdig,
         round(avg(stjerner), 2)            as snitt_stjerner
    from public.innsikt group by 1
)
select kilde,
       coalesce(h.besok, 0)     as besok,
       coalesce(i.historier, 0) as historier,
       coalesce(i.ferdig, 0)    as ferdig,
       i.snitt_stjerner,
       coalesce(h.kjop, 0)      as kjop
  from h full join i using (kilde)
 order by besok desc, historier desc;

-- Prinsen-abonnementene: hvor mange, og hvor lenge de varer før de sies opp.
create or replace view public.innsikt_abonnement with (security_invoker = true) as
select status,
       count(*) as antall,
       round((avg(extract(epoch from (case when status in ('stoppet', 'avsluttet') then oppdatert else now() end) - opprettet)) / 86400.0)::numeric, 1) as snitt_dager
  from public.avtaler
 where status <> 'venter'
 group by status;

revoke all on public.innsikt_frafall, public.innsikt_populaert, public.innsikt_stjerner, public.innsikt_uker,
  public.innsikt_ventetid, public.innsikt_ventetid_frafall, public.innsikt_feil, public.innsikt_vegg,
  public.innsikt_kjop, public.innsikt_hendelser_telt, public.innsikt_kilder, public.innsikt_abonnement
  from anon, authenticated;

-- Det familien har laget selv og vil bruke igjen (se api/_lib/samling.ts):
-- helter tegnet etter et bilde, og lærepenger de har skrevet. Én rad per ting.
--   type: helt | laerepenge
--   data: helt       -> { token, sheet (tegningen som data-URL), tagline, artStyle }
--         laerepenge -> { tekst }
create table if not exists public.samling (
  id         text primary key,
  vipps_sub  text not null references public.brukere(vipps_sub) on delete cascade,
  type       text not null,
  data       jsonb not null,
  opprettet  timestamptz not null default now()
);
create index if not exists samling_bruker_idx
  on public.samling (vipps_sub, type, opprettet desc);
alter table public.samling enable row level security;
