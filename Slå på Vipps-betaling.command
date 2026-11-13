#!/bin/bash
# Slår på betaling med Vipps på www.magiboka.no: enkelthistorier og/eller Prinsen.
# Dobbeltklikk på filen i Finder. Nøklene limes inn i små vinduer og går rett til Vercel.
#
# Før du kjører denne:
#   1. Vipps har godkjent «Integrert betaling» (enkelthistorier) og/eller
#      «Faste betalinger» (Prinsen) for salgsstedet Magiboka.
#   2. Du har kjørt hele supabase/schema.sql i Supabase → SQL Editor.

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"$3\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Vipps-betaling for Magiboka\")" 2>/dev/null
}

janei() {
  osascript -e "button returned of (display dialog \"$1\" buttons {\"Nei\", \"Ja\"} default button \"Ja\" with title \"Vipps-betaling for Magiboka\")" 2>/dev/null
}

legg_inn() {
  vercel env rm "$1" production --yes >/dev/null 2>&1
  if printf '%s' "$2" | vercel env add "$1" production >/dev/null 2>&1; then
    echo "  ✓ $1 er lagt inn"
  else
    echo "  ✗ $1 kunne ikke legges inn"
    FEIL=1
  fi
}

if [ ! -f .vercel/project.json ]; then
  echo "Mappen er ikke koblet til Vercel-prosjektet. Kobler til «magiboka» …"
  vercel link --yes --project magiboka --scope tryms-projects-3bbe5707 >/dev/null 2>&1 \
    || { echo "Klarte ikke å koble til Vercel. Si fra til Claude."; read -r -p "Trykk Enter for å lukke."; exit 1; }
fi

echo "Slår på betaling med Vipps."
echo "Finn nøkkelen i portal.vippsmobilepay.com → For utviklere → salgsenheten «Magiboka» → Vis nøkler."
echo

[ "$(janei "Har du kjørt hele supabase/schema.sql i Supabase etter at betaling ble lagt til?")" = "Ja" ] \
  || { echo "Kjør supabase/schema.sql i Supabase → SQL Editor først. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }

NOKKEL=$(spor "Lim inn Ocp-Apim-Subscription-Key:" skjult)
[ -z "$NOKKEL" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
MSN=$(spor "Merchant Serial Number (MSN) — sjekk at det stemmer:" "" "1190365")
[ -z "$MSN" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
KJOP=$(janei "Har Vipps godkjent «Integrert betaling»? Da slås kjøp av enkelthistorier på.")
ABO=$(janei "Har Vipps godkjent «Faste betalinger»? Da slås Prinsen-abonnementet på.")

FEIL=0
legg_inn VIPPS_SUBSCRIPTION_KEY "$NOKKEL"
legg_inn VIPPS_MSN "$MSN"
legg_inn VIPPS_BETALING "$([ "$KJOP" = "Ja" ] && echo 1 || echo 0)"
legg_inn VIPPS_ABONNEMENT "$([ "$ABO" = "Ja" ] && echo 1 || echo 0)"

# CRON_SECRET slipper bare Vercels egen daglige jobb inn til /api/trekk
# (den som bestiller ukestrekkene). Lages én gang.
if ! vercel env ls production 2>/dev/null | grep -q "CRON_SECRET"; then
  HEM=$(openssl rand -hex 32)
  if printf '%s' "$HEM" | vercel env add CRON_SECRET production >/dev/null 2>&1; then
    echo "  ✓ CRON_SECRET er laget"
  else
    echo "  ✗ CRON_SECRET kunne ikke lages"
    FEIL=1
  fi
fi

echo
if [ "$FEIL" = "0" ]; then
  echo "Publiserer siden på nytt (tar 1–2 minutter) …"
  if vercel deploy --prod --yes >/dev/null 2>&1; then
    SVAR=$(curl -s https://www.magiboka.no/api/meg)
    echo "$SVAR" | grep -q '"kjopKlar":true' && echo "  ✓ Kjøp av enkelthistorier er på"
    echo "$SVAR" | grep -q '"abonnementKlar":true' && echo "  ✓ Prinsen-abonnementet er på"
    echo "Ferdig. Prøv et kjøp selv på www.magiboka.no før du sier fra til andre."
  else
    echo "Publiseringen feilet. Si fra til Claude."
  fi
else
  echo "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."
fi
read -r -p "Trykk Enter for å lukke."
