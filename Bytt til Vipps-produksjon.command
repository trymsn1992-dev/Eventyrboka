#!/bin/bash
# Bytter Vipps fra test til produksjon. Du må ha klar produksjonsnøklene fra Vipps-portalen.
# Dobbeltklikk på filen i Finder.

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Vipps-produksjon for Magiboka\")" 2>/dev/null
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

echo "Bytter Vipps fra test til produksjon."
echo "Finn produksjonsnøklene i portal.vippsmobilepay.com under Utvikler → API-nøkler → Produksjon."
echo

ID=$(spor "Lim inn client_id (produksjon):")
[ -z "$ID" ] && { echo "Avbrutt."; read -r -p "Trykk Enter for å lukke."; exit 1; }
HEMMELIG=$(spor "Lim inn client_secret (produksjon):" skjult)
[ -z "$HEMMELIG" ] && { echo "Avbrutt."; read -r -p "Trykk Enter for å lukke."; exit 1; }
NOKKEL=$(spor "Lim inn Ocp-Apim-Subscription-Key (produksjon):" skjult)
[ -z "$NOKKEL" ] && { echo "Avbrutt."; read -r -p "Trykk Enter for å lukke."; exit 1; }
MSN=$(spor "Lim inn Merchant Serial Number (MSN):")

FEIL=0
vercel env rm VIPPS_MILJO production --yes >/dev/null 2>&1
printf '%s' "prod" | vercel env add VIPPS_MILJO production >/dev/null 2>&1 && echo "  ✓ VIPPS_MILJO = prod"
legg_inn VIPPS_CLIENT_ID "$ID"
legg_inn VIPPS_CLIENT_SECRET "$HEMMELIG"
legg_inn VIPPS_SUBSCRIPTION_KEY "$NOKKEL"
[ -n "$MSN" ] && legg_inn VIPPS_MSN "$MSN"

echo
if [ "$FEIL" = "0" ]; then
  echo "Publiserer siden på nytt …"
  if vercel deploy --prod --yes >/dev/null 2>&1; then
    echo "Ferdig. Vipps-innloggingen er nå i produksjon."
  else
    echo "Publiseringen feilet. Si fra til Claude."
  fi
else
  echo "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."
fi
read -r -p "Trykk Enter for å lukke."
