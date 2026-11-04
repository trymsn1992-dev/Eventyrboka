#!/bin/bash
# Legger Supabase-URL og service-nøkkelen inn hos Vercel og publiserer siden på nytt.
# Dobbeltklikk på filen i Finder. Nøklene limes inn i små vinduer og går rett til Vercel.

export PATH="/Users/trymnordgaard/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")" || exit 1

spor() {
  local skjult=""
  [ "$2" = "skjult" ] && skjult="with hidden answer"
  osascript -e "text returned of (display dialog \"$1\" default answer \"\" $skjult buttons {\"Avbryt\", \"OK\"} default button \"OK\" with title \"Supabase-nøkkel for Magiboka\")" 2>/dev/null
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

echo "Supabase-nøkkel for Magiboka"
echo "Finn URL og «service_role»-nøkkelen i Supabase → Project Settings → API."
echo "ADVARSEL: Service-nøkkelen gir full tilgang til alle tabeller. Del den aldri."
echo

URL=$(spor "Lim inn Project URL (slutter på .supabase.co):")
[ -z "$URL" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }
NOKKEL=$(spor "Lim inn service_role-nøkkelen:" skjult)
[ -z "$NOKKEL" ] && { echo "Avbrutt. Ingenting er endret."; read -r -p "Trykk Enter for å lukke."; exit 1; }

FEIL=0
legg_inn SUPABASE_URL "$URL"
legg_inn SUPABASE_SERVICE_KEY "$NOKKEL"

echo
if [ "$FEIL" = "0" ]; then
  echo "Publiserer siden på nytt …"
  if vercel deploy --prod --yes >/dev/null 2>&1; then
    echo "Ferdig. Nå lagres historiene i Supabase for innloggede brukere."
  else
    echo "Publiseringen feilet. Si fra til Claude."
  fi
else
  echo "Noe gikk galt. Si fra til Claude, så ser vi på det sammen."
fi
read -r -p "Trykk Enter for å lukke."
