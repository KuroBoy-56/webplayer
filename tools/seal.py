#!/usr/bin/env python3
"""
Sello de integridad de la app de iOS (lo usa .github/workflows/ios.yml al empaquetar el .ipa).

Calcula el SHA-256 de la sección __TEXT,__text (el código) del ejecutable arm64 y lo guarda en
LatMpx.app/ic.bin. Al abrir, la app (LatMpx/App/Integrity.swift) calcula lo mismo sobre su código en
memoria y, si no coincide, avisa al panel y se cierra: así una copia modificada no funciona, igual que
la comprobación de la firma del APK en Android. Firmar de nuevo con Sideloadly o AltStore no toca el
código, solo la firma, así que la app instalada por el cliente pasa la comprobación.

  python3 tools/seal.py write <ejecutable> <ic.bin>
  python3 tools/seal.py check <ejecutable> <ic.bin>
"""
import hashlib
import struct
import sys

MASK = bytes([0xC3, 0x78, 0xC5, 0x82, 0x47, 0x0B, 0xFC, 0xCD, 0x24, 0x79, 0xAE, 0x70, 0x54, 0xBB, 0x26, 0x69,
              0x60, 0xE0, 0x4B, 0xE6, 0x72, 0x68, 0xC3, 0x6C, 0x92, 0x0C, 0xD2, 0xA6, 0x8F, 0x49, 0xF5, 0xE2])
CPU_ARM64 = 0x0100000C
LC_SEGMENT_64 = 0x19


def arm64_slice(data: bytes) -> bytes:
    magic = struct.unpack(">I", data[:4])[0]
    if magic in (0xCAFEBABE, 0xCAFEBABF):  # binario "fat": se toma la parte arm64
        n = struct.unpack(">I", data[4:8])[0]
        wide = magic == 0xCAFEBABF
        size = 32 if wide else 20
        for i in range(n):
            e = data[8 + i * size: 8 + (i + 1) * size]
            cpu = struct.unpack(">i", e[:4])[0]
            off = struct.unpack(">Q", e[8:16])[0] if wide else struct.unpack(">I", e[8:12])[0]
            ln = struct.unpack(">Q", e[16:24])[0] if wide else struct.unpack(">I", e[12:16])[0]
            if cpu == CPU_ARM64:
                return data[off: off + ln]
        raise SystemExit("sin arm64")
    return data


def text_digest(path: str) -> bytes:
    data = arm64_slice(open(path, "rb").read())
    if struct.unpack("<I", data[:4])[0] != 0xFEEDFACF:
        raise SystemExit("no es un Mach-O de 64 bits")
    ncmds = struct.unpack("<I", data[16:20])[0]
    p = 32
    for _ in range(ncmds):
        cmd, size = struct.unpack("<II", data[p: p + 8])
        if cmd == LC_SEGMENT_64 and data[p + 8: p + 24].rstrip(b"\0") == b"__TEXT":
            nsects = struct.unpack("<I", data[p + 64: p + 68])[0]
            for s in range(nsects):
                q = p + 72 + s * 80
                if data[q: q + 16].rstrip(b"\0") == b"__text":
                    sz = struct.unpack("<Q", data[q + 40: q + 48])[0]
                    off = struct.unpack("<I", data[q + 48: q + 52])[0]
                    return hashlib.sha256(data[off: off + sz]).digest()
        p += size
    raise SystemExit("sin __TEXT,__text")


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] not in ("write", "check"):
        raise SystemExit(__doc__)
    seal = bytes(a ^ b for a, b in zip(text_digest(sys.argv[2]), MASK))
    if sys.argv[1] == "write":
        open(sys.argv[3], "wb").write(seal)
        print("sello escrito")
    elif open(sys.argv[3], "rb").read() != seal:
        raise SystemExit("el sello no coincide")
    else:
        print("sello correcto")


if __name__ == "__main__":
    main()
