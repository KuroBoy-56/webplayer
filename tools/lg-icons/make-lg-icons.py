#!/usr/bin/env python3
"""Iconos de LG (webOS) desde una sola fuente: el logo de MPX Player con colores planos y el nombre debajo,
sobre el color exacto del mosaico (iconColor de webos/appinfo.json).

Salida (todos PNG RGB opacos, sin canal alfa ni chunks de color):
  webos/icon.png                80x80    icono pequeño del paquete (appinfo "icon")
  webos/largeIcon.png           130x130  icono grande del paquete (appinfo "largeIcon")
  webos/store/appIcon-400.png   400x400  icono de LG Seller Lounge (Application > App Icon)

LG usa el de 400x400 en LG Apps (lo achica solo) y QA lo compara con el color del mosaico: los tres llevan el mismo
fondo, igual a iconColor. Uso: python3 tools/lg-icons/make-lg-icons.py  (necesita Pillow)
"""
import colorsys
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(ROOT, 'assets', 'image', 'logo.png')
FONT = os.path.join(HERE, 'Inter-Bold.ttf')
APPINFO = os.path.join(ROOT, 'webos', 'appinfo.json')

# colores planos del logo (sin degradados ni sombras, como los pidió LG en la revisión de la 1.3.7) y del nombre
RED, YELLOW, BLUE, WHITE = (229, 1, 30), (254, 205, 3), (0, 106, 225), (255, 255, 255)
SUPER = 4  # se dibuja a 4x y se achica promediando (sin LANCZOS): bordes suaves sin halos ni rebotes de otro tono
FULL_ALPHA = 235  # el interior de logo.png tiene alfa 239-255 (textura): desde aquí cuenta como opaco

# composición (fracciones del lado), la de los iconos de la 1.3.9: logo arriba al centro, nombre debajo
LOGO_TOP, LOGO_H = 0.154, 0.50
TEXT_TOP, TEXT_W = 0.738, 0.669


def hex_rgb(h):
    h = h.strip().lstrip('#')
    if len(h) != 6:
        raise SystemExit('iconColor debe ser #RRGGBB: ' + h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def logo_masks():
    """Una máscara (L) por color del logo: el tono decide el color, el brillo bajo (las uniones) queda en el fondo."""
    src = Image.open(LOGO).convert('RGBA')
    src = src.crop(src.getbbox())
    w, h = src.size
    masks = {c: Image.new('L', (w, h), 0) for c in (RED, YELLOW, BLUE)}
    px = src.load()
    mp = {c: m.load() for c, m in masks.items()}
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hue, sat, val = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            deg = hue * 360
            if deg >= 320 or deg < 22:
                c = RED
            elif deg < 90:
                c = YELLOW
            elif 150 <= deg < 280:
                c = BLUE
            else:
                continue
            cover = min(1.0, max(0.0, (val - 0.12) / (0.30 - 0.12)))  # textura = color lleno; uniones oscuras = fondo
            mp[c][x, y] = int(round(cover * min(255, a * 255 / FULL_ALPHA)))
    return masks


def render(size, bg, masks):
    S = size * SUPER
    canvas = Image.new('RGB', (S, S), bg)
    lw, lh = next(iter(masks.values())).size
    th = round(LOGO_H * S)
    tw = round(lw * th / lh)
    left, top = (S - tw) // 2, round(LOGO_TOP * S)
    for color, m in masks.items():
        canvas.paste(Image.new('RGB', (tw, th), color), (left, top), m.resize((tw, th), Image.BILINEAR))
    # nombre: Inter Bold blanco, ancho fijo y centrado
    text = 'MPX Player'
    probe = ImageFont.truetype(FONT, 100)
    x0, y0, x1, y1 = probe.getbbox(text)
    font = ImageFont.truetype(FONT, max(1, round(100 * (TEXT_W * S) / (x1 - x0))))
    x0, y0, x1, y1 = font.getbbox(text)
    d = ImageDraw.Draw(canvas)
    d.text(((S - (x1 - x0)) / 2 - x0, TEXT_TOP * S - y0), text, font=font, fill=WHITE)
    return canvas.reduce(SUPER)  # promedio de cada bloque 4x4: el fondo queda exacto, sin píxeles casi negros


def main():
    info = json.load(open(APPINFO, encoding='utf-8'))
    bg = hex_rgb(info['iconColor'])
    masks = logo_masks()
    targets = [(80, os.path.join(ROOT, 'webos', info['icon'])),
               (130, os.path.join(ROOT, 'webos', info['largeIcon'])),
               (400, os.path.join(ROOT, 'webos', 'store', 'appIcon-400.png'))]
    for size, path in targets:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        render(size, bg, masks).save(path, 'PNG', optimize=True)
        print('%s  %dx%d  fondo #%02X%02X%02X' % (os.path.relpath(path, ROOT), size, size, *bg))


if __name__ == '__main__':
    sys.exit(main())
