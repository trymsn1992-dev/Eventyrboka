#!/bin/bash
# Setter opp en egen testversjon av Magiboka mot Vipps sitt testmiljø:
#   https://magiboka-vippstest.vercel.app
# Der er betaling slått på, og ingen ekte penger trekkes. www.magiboka.no røres ikke.
# Dobbeltklikk på filen i Finder. Nøklene limes inn i små vinduer og går rett til Vercel.
#
# Før du kjører denne:
#   1. Kjør hele supabase/schema.sql i Supabase → SQL Editor (lager tabellene kjop og avtaler).
#   2. Ha testnøklene klare: portal.vippsmobilepay.com → For utviklere → Test.

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1
ADRESSE="magiboka-vippstest.vercel.app"

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Vipps-test for Magiboka\")" 2>/dev/null
}

avbryt() { echo "Avbrutt. $1"; read -r -p "Trykk Enter for å lukke."; exit 1; }

# Legger en verdi inn for forhåndsvisninger (Preview) — aldri for produksjon.
legg_inn() {
  vercel env rm "$1" preview --yes >/dev/null 2>&1
  if printf '%s' "$2" | vercel env add "$1" preview "" --yes >/dev/null 2>&1; then
    echo "  ✓ $1 er lagt inn"
  else
    echo "  ✗ $1 kunne ikke legges inn"
    FEIL=1
  fi
}

finnes() { vercel env ls preview 2>/dev/null | grep -q "^ *$1 "; }

if [ ! -f .vercel/project.json ]; then
  vercel link --yes --project magiboka --scope tryms-projects-3bbe5707 >/dev/null 2>&1 \
    || avbryt "Klarte ikke å koble til Vercel. Si fra til Claude."
fi

echo "Setter opp testversjonen på https://$ADRESSE"
echo "Finn testnøklene i portal.vippsmobilepay.com → For utviklere → Test."
echo

ID=$(spor "Vipps TEST – lim inn client_id:")
[ -z "$ID" ] && avbryt "Ingenting er endret."
HEMMELIG=$(spor "Vipps TEST – lim inn client_secret:" skjult)
[ -z "$HEMMELIG" ] && avbryt "Ingenting er endret."
NOKKEL=$(spor "Vipps TEST – lim inn Ocp-Apim-Subscription-Key:" skjult)
[ -z "$NOKKEL" ] && avbryt "Ingenting er endret."
MSN=$(spor "Vipps TEST – Merchant Serial Number (MSN) for test-salgsenheten:")
[ -z "$MSN" ] && avbryt "Ingenting er endret."

FEIL=0
legg_inn VIPPS_MILJO "test"
legg_inn VIPPS_CLIENT_ID "$ID"
legg_inn VIPPS_CLIENT_SECRET "$HEMMELIG"
legg_inn VIPPS_SUBSCRIPTION_KEY "$NOKKEL"
legg_inn VIPPS_MSN "$MSN"
legg_inn VIPPS_BETALING "1"
legg_inn VIPPS_ABONNEMENT "1"

# Databasen: den samme som produksjon bruker. Testbrukere fra Vipps blir egne
# brukere der, så de blander seg ikke med ekte kontoer.
if ! finnes SUPABASE_URL || ! finnes SUPABASE_SERVICE_KEY; then
  SB_URL=$(spor "Supabase – lim inn Project URL (Project Settings → API):")
  [ -z "$SB_URL" ] && avbryt "Vipps-nøklene er lagt inn, men Supabase mangler. Kjør skriptet på nytt."
  SB_KEY=$(spor "Supabase – lim inn service_role-nøkkelen:" skjult)
  [ -z "$SB_KEY" ] && avbryt "Vipps-nøklene er lagt inn, men Supabase mangler. Kjør skriptet på nytt."
  legg_inn SUPABASE_URL "$SB_URL"
  legg_inn SUPABASE_SERVICE_KEY "$SB_KEY"
fi

# Egne hemmeligheter for testversjonen — ikke de samme som i produksjon.
finnes SESSION_SECRET || legg_inn SESSION_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
finnes CRON_SECRET || legg_inn CRON_SECRET "$(openssl rand -hex 32)"

echo
[ "$FEIL" = "0" ] || avbryt "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."

echo "Publiserer testversjonen (tar 1–2 minutter) …"
URL=$(vercel deploy --yes 2>/dev/null | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)
[ -z "$URL" ] && avbryt "Publiseringen feilet. Si fra til Claude."
vercel alias set "$URL" "$ADRESSE" >/dev/null 2>&1 || avbryt "Fikk ikke satt adressen. Si fra til Claude."

echo
echo "Ferdig. Testversjonen ligger på:"
echo "  https://$ADRESSE"
echo
echo "Én ting til i Vipps-portalen (test-salgsenheten → Konfigurer innlogging):"
echo "legg inn denne tilbakeadressen, nøyaktig slik:"
echo "  https://$ADRESSE/api/vipps/tilbake"
echo
echo "Si så fra til Claude, så sjekker vi at alt svarer."
read -r -p "Trykk Enter for å lukke."
