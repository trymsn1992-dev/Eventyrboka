#!/bin/bash
# Kobler «Logg inn med Vipps» til produksjon på www.magiboka.no.
# Dobbeltklikk på filen i Finder. Nøklene limes inn i små vinduer og går rett til Vercel.
#
# Før du kjører denne: legg inn tilbakeadressen under «Konfigurer innlogging»
# i Vipps-portalen — nøyaktig slik, uten skråstrek på slutten:
#   https://www.magiboka.no/api/vipps/tilbake

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"$3\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Vipps-produksjon for Magiboka\")" 2>/dev/null
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

echo "Kobler Vipps-innloggingen til produksjon."
echo "Finn nøklene i portal.vippsmobilepay.com → For utviklere → salgsenheten «Magiboka» → Vis nøkler."
echo
echo "Har du lagt inn tilbakeadressen under «Konfigurer innlogging»?"
echo "  https://www.magiboka.no/api/vipps/tilbake"
echo

ID=$(spor "Lim inn Client ID:")
[ -z "$ID" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
HEMMELIG=$(spor "Lim inn Client Secret:" skjult)
[ -z "$HEMMELIG" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
NOKKEL=$(spor "Lim inn Ocp-Apim-Subscription-Key hvis den står under Vis nøkler. Står den ikke der, trykk OK uten å skrive noe." skjult)
MSN=$(spor "Merchant Serial Number (MSN) — sjekk at det stemmer:" "" "1190365")

FEIL=0
vercel env rm VIPPS_MILJO production --yes >/dev/null 2>&1
printf '%s' "prod" | vercel env add VIPPS_MILJO production >/dev/null 2>&1 && echo "  ✓ VIPPS_MILJO = prod"
legg_inn VIPPS_CLIENT_ID "$ID"
legg_inn VIPPS_CLIENT_SECRET "$HEMMELIG"
if [ -n "$NOKKEL" ]; then
  legg_inn VIPPS_SUBSCRIPTION_KEY "$NOKKEL"
else
  vercel env rm VIPPS_SUBSCRIPTION_KEY production --yes >/dev/null 2>&1
fi
[ -n "$MSN" ] && legg_inn VIPPS_MSN "$MSN"

# SESSION_SECRET signerer innloggings-cookien. Lages tilfeldig første gang og
# må deretter ligge fast — endres den, blir alle brukere logget ut.
if ! vercel env ls production 2>/dev/null | grep -q "SESSION_SECRET"; then
  HEM=$(openssl rand -base64 48 | tr -d '\n')
  if printf '%s' "$HEM" | vercel env add SESSION_SECRET production >/dev/null 2>&1; then
    echo "  ✓ SESSION_SECRET er laget"
  else
    echo "  ✗ SESSION_SECRET kunne ikke lages"
    FEIL=1
  fi
fi

echo
if [ "$FEIL" = "0" ]; then
  echo "Publiserer siden på nytt (tar 1–2 minutter) …"
  if vercel deploy --prod --yes >/dev/null 2>&1; then
    if curl -s https://www.magiboka.no/api/meg | grep -q '"vippsKlar":true'; then
      echo "Ferdig. Åpne www.magiboka.no og trykk «Logg inn med Vipps»."
    else
      echo "Siden er publisert, men Vipps svarer ikke klar ennå. Si fra til Claude."
    fi
  else
    echo "Publiseringen feilet. Si fra til Claude."
  fi
else
  echo "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."
fi
read -r -p "Trykk Enter for å lukke."
