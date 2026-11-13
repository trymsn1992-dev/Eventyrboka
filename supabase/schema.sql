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
