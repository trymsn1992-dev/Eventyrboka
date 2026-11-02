# Magiboka

Interaktive AI-genererte barnebøker på norsk.

## Arkitektur

- **Frontend**: Vite + React (bygges til statiske filer i `dist/`)
- **Backend**: Serverless functions i `/api` (Vercel-stil). Alle kall mot
  Google Gemini skjer her — API-nøkkelen eksponeres ALDRI til nettleseren.

```
Nettleser  ──►  /api/story   ──►  Gemini (tekst)
Nettleser  ──►  /api/image   ──►  Gemini (bilde)
Nettleser  ──►  /api/speech  ──►  Gemini (TTS)
```

## Kjøre lokalt

1. Installer avhengigheter:
   ```bash
   npm install
   ```

2. Lag en `.env.local` i rotmappa med Gemini-nøkkelen din:
   ```
   GEMINI_API_KEY=din-ekte-nøkkel-her
   ```
   `.env.local` er gitignored.

3. Kjør frontend:
   ```bash
   npm run dev
   ```

4. For å teste `/api/*` lokalt, kjør med Vercel CLI:
   ```bash
   npm install -g vercel
   vercel dev
   ```
   `vercel dev` kjører både frontend og serverless functions sammen.

## Deploy

Dette prosjektet er satt opp for Vercel.

1. Koble repoet til Vercel (`vercel link` eller via dashboardet).
2. Sett `GEMINI_API_KEY` som environment variable i Vercel-prosjektet (ikke sjekk den inn).
3. Push til main — Vercel bygger frontend og deployer `/api/*` som serverless functions.
4. Koble `magiboka.no` til Vercel-prosjektet via DNS.

## Sikkerhet

- Gemini-nøkkelen leses kun fra `process.env.GEMINI_API_KEY` på serversiden.
- Alle API-endepunkter har enkel in-memory rate-limiting per IP (30 req/min).
  For sterkere beskyttelse: bytt ut `api/_lib/rate-limit.ts` med Upstash Ratelimit.
- Input fra klienten valideres mot kjente verdier (`api/_lib/validate.ts`) før
  det settes inn i prompter.
- Innhold tunes med strenge sikkerhetsregler i system-prompten i `api/story.ts`.
