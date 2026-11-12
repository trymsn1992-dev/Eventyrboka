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
