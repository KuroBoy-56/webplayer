#!/usr/bin/env bash
# Firma dist/ como out/MPXPlayer.wgt con la CLI de Tizen Studio.
# - Con los secretos TIZEN_AUTHOR_P12 + TIZEN_DISTRIBUTOR_P12 (certificado Samsung de tus televisores, en
#   base64) y sus contraseñas TIZEN_AUTHOR_PASS / TIZEN_DISTRIBUTOR_PASS, el .wgt se instala directo en esos TV.
# - Sin ellos: certificado de autor nuevo + distribuidor público de Tizen (emulador, o volver a firmar
#   con tu certificado Samsung: ver README).
set -euo pipefail
DATA="$HOME/tizen-studio-data"
KEYS="$(mktemp -d)"
trap 'rm -rf "$KEYS"' EXIT
PROFILES="$DATA/profile/profiles.xml"

if [ -n "${TIZEN_AUTHOR_P12:-}" ] && [ -n "${TIZEN_DISTRIBUTOR_P12:-}" ]; then
  echo "$TIZEN_AUTHOR_P12" | base64 -d > "$KEYS/author.p12"
  echo "$TIZEN_DISTRIBUTOR_P12" | base64 -d > "$KEYS/distributor.p12"
  export AP="${TIZEN_AUTHOR_PASS:-}" DP="${TIZEN_DISTRIBUTOR_PASS:-}"
  tizen security-profiles add -n mpx -a "$KEYS/author.p12" -p "$AP" -d "$KEYS/distributor.p12" -dp "$DP" > /dev/null
  echo "Firmado con el certificado Samsung (secretos TIZEN_*)."
  echo "kind=samsung" >> "${GITHUB_OUTPUT:-/dev/null}"
else
  # con letras fuera de 0-9a-f: la CLI toma una contraseña "hex" como cifrada y la vuelve a pedir
  export AP="mpx_$(openssl rand -hex 10)_Key" DP=tizenpkcs12passfordsigner
  tizen certificate -a MPXPlayer -p "$AP" -c MX -n "MPX Player" -f mpx > /dev/null
  tizen security-profiles add -n mpx -a "$DATA/keystore/author/mpx.p12" -p "$AP" > /dev/null
  echo "Firmado con un certificado de autor nuevo y el distribuidor público de Tizen."
  echo "kind=tizen" >> "${GITHUB_OUTPUT:-/dev/null}"
fi

# sin escritorio no hay llavero: las contraseñas van en profiles.xml (autor primero, distribuidor después)
node -e '
const fs = require("fs");
const f = process.argv[1];
const pw = [process.env.AP, process.env.DP];
const esc = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
let i = 0;
fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/password="[^"]*"/g, m => (i < 2 ? `password="${esc(pw[i++])}"` : m)));
' "$PROFILES"

tizen package -t wgt -s mpx -- "$PWD/dist"
mkdir -p out
mv dist/*.wgt out/MPXPlayer.wgt
# sin firma el televisor no la instala: mejor fallar aquí
unzip -l out/MPXPlayer.wgt | grep -q author-signature.xml || { echo "El .wgt salió sin firma" >&2; exit 1; }
ls -la out
