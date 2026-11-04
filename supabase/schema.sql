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
