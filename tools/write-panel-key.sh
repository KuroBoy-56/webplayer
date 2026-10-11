#!/bin/sh
# Escribe LatMpx/Data/PanelKey.swift con la llave maestra del panel (PANEL_MASTER_KEY, 64 hex).
# El archivo no se sube a git. Sin la llave la app compila, pero la activación no funciona.
set -eu
out="$(dirname "$0")/../LatMpx/Data/PanelKey.swift"
key="${PANEL_MASTER_KEY:-}"
mask=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
python3 - "$key" "$mask" "$out" <<'PY'
import sys
key, mask, out = sys.argv[1].strip().lower(), sys.argv[2], sys.argv[3]
ok = len(key) == 64 and all(c in "0123456789abcdef" for c in key)
k = bytes.fromhex(key) if ok else b""
m = bytes.fromhex(mask)
x = bytes(a ^ m[i % len(m)] for i, a in enumerate(k))
arr = lambda b: ", ".join("0x%02x" % v for v in b)
with open(out, "w") as f:
    f.write("// Generado por tools/write-panel-key.sh. No subir a git.\n")
    f.write("enum PanelKey {\n")
    f.write("    static let masked: [UInt8] = [%s]\n" % arr(x))
    f.write("    static let mask: [UInt8] = [%s]\n" % arr(m))
    f.write("}\n")
print("PanelKey.swift:", "con llave" if ok else "SIN llave")
PY
