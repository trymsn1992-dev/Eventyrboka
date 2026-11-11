# Vipps-innlogging + Supabase for Magiboka

Dette er oppskriften for å få **«Logg inn med Vipps»** og **lagring av historier i Supabase** opp å stå. Koden er allerede på plass i prosjektet — det som gjenstår er å lage de to kontoene og lime inn fire nøkler.

Følg stegene i rekkefølge. Tar ca. 45–60 minutter første gang.

---

## 1. Supabase (lagring av brukere og historier)

### 1a. Lag et prosjekt
1. Gå til [supabase.com](https://supabase.com) og logg inn.
2. Klikk **New project**.
3. Fyll inn:
   - **Name:** `magiboka`
   - **Database Password:** la Supabase lage en — kopier den og lagre i passordhvelvet.
   - **Region:** `Frankfurt (eu-central-1)` eller `Stockholm (eu-north-1)` — EU er viktig (GDPR).
   - **Plan:** Free holder lenge.
4. Vent til prosjektet er klart (ca. 2 min).

### 1b. Kjør skjemaet
1. I Supabase: **SQL Editor → New query**.
2. Åpne [`supabase/schema.sql`](supabase/schema.sql) i dette prosjektet, kopier alt, lim inn i SQL-editoren.
3. Trykk **Run**. Du skal se «Success. No rows returned».

### 1c. Hent URL og service-nøkkel
1. **Project Settings → API**.
2. Kopier:
   - **Project URL** (slutter på `.supabase.co`)
   - **service_role** key under **Project API keys** (ikke anon/public!)

> ⚠️ **service_role** gir full tilgang til databasen. Ikke lim den inn i noen chat eller sjekk den inn i git.

### 1d. Legg inn nøklene
Dobbeltklikk `Legg inn Supabase-nøkkel.command` i Finder, og lim inn de to verdiene når du blir spurt.

---

## 2. Vipps (innlogging med Vipps)

### 2a. Lag en konto hos Vipps for bedrifter
1. Gå til [portal.vippsmobilepay.com](https://portal.vippsmobilepay.com).
2. Logg inn med Vipps med fødselsnummer.
3. Velg eller legg til bedriften (Nordgård, org.nr. 937 095 082).

### 2b. Bestill «Logg inn med Vipps»
1. I portalen: **Produkter → Logg inn med Vipps → Kom i gang**.
2. Fyll ut søknaden:
   - **Bedriftens navn:** Magiboka
   - **Nettadresse:** `https://magiboka.no` (eller det Vercel-domenet du bruker)
   - **Hva bruker dere innloggingen til:** «La brukere lagre eventyr i egen konto, så de følger dem mellom enheter.»
   - **Hvilke data trenger dere:** kryss bare av **Navn**.
3. Last opp den kvadratiske logoen — [`public/magiboka-logo-firkant.svg`](public/magiboka-logo-firkant.svg) (eller PNG hvis Vipps krever det — se nederst).
4. Send inn. Behandlingstid er 1–3 virkedager.

### 2c. Legg til tilbakeadresse
Mens dere venter på godkjenningen:
1. **Utvikler → Mine salgsenheter → velg salgsenheten «Magiboka»**.
2. Under **Tilbake-URL (redirect URI)**, legg til:
   - `https://magiboka.no/api/vipps/tilbake` (bytt ut magiboka.no med Vercel-domenet dere faktisk bruker — f.eks. `https://eventyrboka.vercel.app/api/vipps/tilbake`)

### 2d. Hent testnøklene
1. **Utvikler → API-nøkler → Test**.
2. Noter:
   - **client_id**
   - **client_secret**
   - **Ocp-Apim-Subscription-Key** (primærnøkkelen)
   - **Merchant Serial Number (MSN)** — står øverst i salgsenheten.

### 2e. Legg inn nøklene
Dobbeltklikk `Legg inn Vipps-nøkler.command` i Finder, og lim inn de fire verdiene når du blir spurt.

Skriptet setter også automatisk **VIPPS_MILJO = test** og lager en **SESSION_SECRET** (hvis den ikke finnes fra før).

### 2f. Når dere er klare for produksjon
1. Få godkjent «Logg inn med Vipps» i portalen (de sender e-post). ✅ Godkjent 11. nov. 2026 for salgsstedet «Magiboka», MSN 1190365.
2. I bedriftsportalen: **For utviklere** → salgsenheten **Magiboka** → **Konfigurer innlogging**. Legg inn tilbakeadressen nøyaktig slik, uten skråstrek på slutten:
   `https://www.magiboka.no/api/vipps/tilbake`
   (Bruk `www.` — `magiboka.no` sender alle videre til `www.magiboka.no`, så det er den adressen Vipps ser.)
3. Trykk **Vis nøkler** og ha **Client ID** og **Client Secret** klare.
4. Dobbeltklikk `Bytt til Vipps-produksjon.command`. Skriptet setter `VIPPS_MILJO = prod`, legger inn nøklene, lager `SESSION_SECRET` hvis den mangler, publiserer på nytt og sjekker at innloggingen svarer klar.

---

## 3. Prøv det

1. Gå til `https://magiboka.no` (eller Vercel-forhåndsvisningen).
2. Du skal nå se **«Logg inn med Vipps»** i toppen.
3. Klikk → logg inn med test-Vipps (fås fra [developer.vippsmobilepay.com → Testbrukere](https://developer.vippsmobilepay.com/docs/test-environment/)).
4. Når du kommer tilbake, skal du se **«Hei, [fornavn]»** og en **Logg ut**-knapp.
5. Lag et eventyr, trykk **Lagre**. Historien ligger nå i Supabase — åpne siden i en annen nettleser og logg inn med samme Vipps, så ligger historien der også.

---

## Feilsøking

| Symptom | Mest sannsynlig årsak |
|---|---|
| «Logg inn med Vipps»-knappen vises ikke | `VIPPS_CLIENT_ID`/`VIPPS_CLIENT_SECRET` mangler, eller `VIPPS_MILJO` er ikke satt. Kjør `vercel env ls production` og sjekk. |
| `?vipps=feil` i adressen etter innlogging | Sjekk Vercel-loggene: `vercel logs --prod`. Oftest feil tilbakeadresse (steg 2c) eller feil nøkler. |
| «Hei, [tomt]» etter innlogging | Vipps userinfo-kallet feilet. Sjekk at scope `openid name` er godkjent for salgsenheten. |
| Historier lagres ikke for innloggede brukere | `SUPABASE_URL` eller `SUPABASE_SERVICE_KEY` mangler, eller skjemaet (steg 1b) er ikke kjørt. |
| Alle logges ut når jeg oppdaterer | `SESSION_SECRET` ble endret. Den må ligge fast — ellers er alle cookies ugyldige. |

Hvis Vipps krever PNG og ikke SVG: åpne `public/magiboka-logo-firkant.svg` i Preview, velg **File → Export…**, format **PNG**, oppløsning 1024×1024. Du kan også be meg om en ferdig PNG.

---

## Hva er nytt i koden

- `api/_lib/session.ts` — signert cookie-sesjon (ingen passord lagres noe sted, bare en signatur med `SESSION_SECRET`).
- `api/_lib/vipps.ts` — Vipps OpenID Connect-oppsett.
- `api/_lib/supabase.ts` — snakker med Supabase over REST.
- `api/vipps/start.ts` + `api/vipps/tilbake.ts` — innloggingen.
- `api/meg.ts` — forteller siden om du er logget inn.
- `api/loggut.ts` — logger ut.
- `api/stories.ts` — henter, lagrer og sletter historier for innlogget bruker.
- `services/account.ts` — klientsidens innpakking av alt over, med fallback til IndexedDB når man ikke er logget inn.
- `App.tsx` — ny «Logg inn med Vipps»/«Hei, X / Logg ut» øverst, og historier leses nå fra Supabase når man er logget inn (ellers fra IndexedDB som før).
- `supabase/schema.sql` — SQL å kjøre i Supabase én gang.
- `vercel.json` — Stockholm-region og sikkerhetsheadere.

Logger du ut, blir lokale historier (fra guest-modus) stående — de forsvinner ikke. Logger du inn med en bruker som har historier lokalt, flyttes de automatisk opp til kontoen første gang.
