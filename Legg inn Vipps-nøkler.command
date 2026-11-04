#!/bin/bash
# Legger Vipps-testnøklene inn hos Vercel og publiserer siden på nytt.
# Dobbeltklikk på filen i Finder. Nøklene limes inn i små vinduer og går rett til Vercel.

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Vipps-nøkler for Magiboka\")" 2>/dev/null
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

echo "Vipps-nøkler for Magiboka"
echo "Finn nøklene i portal.vippsmobilepay.com under Utvikler → API-nøkler → Test."
echo

ID=$(spor "Lim inn client_id:")
[ -z "$ID" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
HEMMELIG=$(spor "Lim inn client_secret:" skjult)
[ -z "$HEMMELIG" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
NOKKEL=$(spor "Lim inn Ocp-Apim-Subscription-Key (primærnøkkelen). Finner du den ikke, trykk OK uten å skrive noe." skjult)
MSN=$(spor "Skriv inn Merchant Serial Number (MSN). Finner du det ikke, trykk OK uten å skrive noe.")

FEIL=0
# Setter miljøet til test. Bruk «Bytt til Vipps-produksjon.command» når dere skal gå live.
vercel env rm VIPPS_MILJO production --yes >/dev/null 2>&1
printf '%s' "test" | vercel env add VIPPS_MILJO production >/dev/null 2>&1 && echo "  ✓ VIPPS_MILJO = test"
legg_inn VIPPS_CLIENT_ID "$ID"
legg_inn VIPPS_CLIENT_SECRET "$HEMMELIG"
[ -n "$NOKKEL" ] && legg_inn VIPPS_SUBSCRIPTION_KEY "$NOKKEL"
[ -n "$MSN" ] && legg_inn VIPPS_MSN "$MSN"

# SESSION_SECRET — lages tilfeldig hvis den ikke finnes. Den må være lik på hvert
# oppsett, ellers logges brukerne ut hver gang den endres.
if ! vercel env ls production 2>/dev/null | grep -q "SESSION_SECRET"; then
  HEM=$(openssl rand -base64 48 | tr -d '\n')
  printf '%s' "$HEM" | vercel env add SESSION_SECRET production >/dev/null 2>&1 && echo "  ✓ SESSION_SECRET er laget"
fi

echo
if [ "$FEIL" = "0" ]; then
  echo "Publiserer siden på nytt …"
  if vercel deploy --prod --yes >/dev/null 2>&1; then
    echo "Ferdig. Åpne siden og trykk «Logg inn med Vipps»."
  else
    echo "Publiseringen feilet. Si fra til Claude."
  fi
else
  echo "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."
fi
read -r -p "Trykk Enter for å lukke."
