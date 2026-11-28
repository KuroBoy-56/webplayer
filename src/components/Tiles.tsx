// Portadas, tarjetas de plataformas/géneros y filas horizontales estilo Netflix.
import React, { memo, useCallback, useMemo } from 'react';
import type { ListRenderItem } from 'react-native';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { isItem, Item, Row, Special } from '../data/catalog';
import { t } from '../lib/i18n';
import { alpha, C, px, SIDE, themed } from '../theme';
import { Focusable } from './ui';
import { ChainImage } from './ChainImage';
import { posterSources } from '../lib/images';
import { GoSportsTile, LIVE_H, LiveTile } from './LiveTile';

// funciones: la escala se conoce al medir la pantalla (después de importar este archivo)
export const posterW = () => px(210);
export const posterH = () => px(315);

// 2.6.11: onPress / onFocus reciben la tarjeta y son las mismas en cada dibujo de la fila: al mover el foco solo se
// vuelven a dibujar las dos tarjetas que cambian (antes cada fila volvía a dibujar todas sus tarjetas)
export const PosterTile = memo(function PosterTile({
  item,
  onPress,
  onFocus,
  progress,
  rank,
  wide,
  preferred,
}: {
  item: Item;
  onPress: (it: Item) => void;
  onFocus?: (it: Item) => void;
  progress?: number;
  rank?: number;
  wide?: boolean;
  preferred?: boolean;
}) {
  const w = wide ? px(300) : posterW();
  const h = wide ? px(169) : posterH();
  const press = useCallback(() => onPress(item), [onPress, item]);
  const focus = useMemo(() => (onFocus ? () => onFocus(item) : undefined), [onFocus, item]);
  // carátula del panel (o la de TMDB por el título si el servidor no tiene) y, si no carga, la original
  const src = useMemo(() => posterSources(item.kind, item.poster, item.name, item.year, item.tm), [item.kind, item.poster, item.name, item.year, item.tm]);
  return (
    <View style={rank ? s.rankWrap : undefined}>
      {rank ? <Text style={s.rank}>{rank}</Text> : null}
      <Focusable onPress={press} onFocus={focus} preferred={preferred} style={f => [s.tile, { width: w, height: h }, f && s.tileF]}>
        <View style={s.fill}>
          <Text style={s.fallback} numberOfLines={4}>
            {item.name}
          </Text>
          {src.length ? <ChainImage sources={src} style={s.img} resizeMode={wide || item.kind === 'live' ? 'contain' : 'cover'} /> : null}
          {progress !== undefined && progress > 0 ? (
            <View style={s.bar}>
              <View style={[s.barFill, { width: `${Math.min(100, Math.max(3, progress * 100))}%` }]} />
            </View>
          ) : null}
        </View>
      </Focusable>
    </View>
  );
});

export const SpecialTile = memo(function SpecialTile({ sp, onPress: pressSp, onFocus: focusSp, preferred }: { sp: Special; onPress: (sp: Special) => void; onFocus?: (sp: Special) => void; preferred?: boolean }) {
  const onPress = useCallback(() => pressSp(sp), [pressSp, sp]);
  const onFocus = useMemo(() => (focusSp ? () => focusSp(sp) : undefined), [focusSp, sp]);
  if (sp.kind === 'live' && sp.extra === 'sports') return <GoSportsTile onPress={onPress} onFocus={onFocus} />;
  if (sp.kind === 'live' && sp.live) return <LiveTile c={sp.live} onPress={onPress} onFocus={onFocus} />;
  if (sp.kind === 'platform') {
    return (
      // mosaico 16:9 como Roku: la imagen entera (las de plataformas son 16:9), fondo oscuro y borde fino. Con ancho y
      // alto fijos: Vega dibuja las imágenes del paquete a su tamaño real si solo se estiran con left/right (se veían
      // gigantes y cortadas)
      <Focusable onPress={onPress} onFocus={onFocus} preferred={preferred} style={f => [s.plat, f && s.platF]}>
        {f => (
          <>
            {sp.image ? <Image source={sp.image} style={s.platImg} resizeMode="contain" /> : <Text style={[s.platText, { color: sp.color }]}>{sp.label}</Text>}
            {/* el borde (y el de foco) encima del logo: antes el logo, de tamaño fijo, tapaba el borde de foco */}
            <View pointerEvents="none" style={[s.platRing, f && s.platRingF]} />
          </>
        )}
      </Focusable>
    );
  }
  if (sp.kind === 'genre') return <GenreTile sp={sp} onPress={onPress} onFocus={onFocus} preferred={preferred} />;
  return (
    <Focusable onPress={onPress} onFocus={onFocus} preferred={preferred} style={f => [s.tile, s.more, f && s.tileF]}>
      <Text style={s.moreText}>{t('Ver todo')} ›</Text>
    </Focusable>
  );
});

// género: el color de siempre con su dibujo de líneas (blanco translúcido: el mismo color, más claro), el póster del
// título más destacado a la derecha y el nombre abajo a la izquierda. Ancho y alto fijos (Vega, ver plataformas)
const GenreTile = memo(function GenreTile({ sp, onPress, onFocus, preferred }: { sp: Special; onPress: () => void; onFocus?: () => void; preferred?: boolean }) {
  const f = sp.feat;
  const src = useMemo(() => (f ? posterSources(f.kind, f.poster, f.name, f.year, f.tm) : []), [f]);
  return (
    <Focusable onPress={onPress} onFocus={onFocus} preferred={preferred} style={fo => [s.genre, { backgroundColor: sp.color === '#000000' ? '#222' : sp.color }, fo && s.tileF]}>
      {sp.art ? <Image source={sp.art} style={s.genreArt} resizeMode="stretch" /> : null}
      {src.length ? (
        <View style={s.genrePosterBox}>
          <ChainImage sources={src} style={s.genrePoster} resizeMode="cover" />
        </View>
      ) : null}
      <Text style={[s.genreText, src.length ? s.genreTextNarrow : null]} numberOfLines={2}>
        {sp.label}
      </Text>
    </Focusable>
  );
});

// alto de la fila de tarjetas y de la fila completa (título + tarjetas): fijo, así la lista del inicio sabe dónde
// queda cada fila y deja la enfocada siempre arriba (como Roku y Netflix)
export const cardsHeight = (row: Row) =>
  row.type === 'live' ? LIVE_H() + px(34) : row.type === 'platform' ? px(190) : row.type === 'genre' ? px(212) : posterH() + px(30);
export const rowHeight = (row: Row) => cardsHeight(row) + (row.title ? px(46) : px(4)) + px(18);

export const RowView = memo(function RowView({
  row,
  onItem,
  onSpecial,
  onFocusItem,
  onFocusAny,
  rowIndex,
  onFocusRow,
  progressOf,
  live = true,
  focusKey,
  focusRev = 0,
  focusPref = false,
}: {
  row: Row;
  onItem: (it: Item) => void;
  onSpecial: (sp: Special) => void;
  onFocusItem?: (it: Item) => void;
  // cualquier tarjeta de la fila (también plataformas, géneros y «Ver todo»)
  onFocusAny?: (x: Item | Special) => void;
  rowIndex?: number;
  onFocusRow?: (index: number, x: Item | Special) => void;
  progressOf?: (it: Item) => number | undefined;
  // false: fila lejos del foco, solo su título y su alto (Inicio la monta antes de llegar, src/lib/rowwindow.ts)
  live?: boolean;
  // al volver de la ficha: la tarjeta que tenía el foco se vuelve a montar con «preferred» (focusRev la monta de nuevo)
  focusKey?: string;
  focusRev?: number;
  // «preferred» solo un momento (si la tarjeta se vuelve a montar al desplazarse, no roba el foco)
  focusPref?: boolean;
}) {
  const height = cardsHeight(row);
  const focus = useCallback((x: Item | Special) => {
    if (isItem(x)) onFocusItem?.(x);
    onFocusAny?.(x);
    if (rowIndex !== undefined) onFocusRow?.(rowIndex, x);
  }, [onFocusItem, onFocusAny, rowIndex, onFocusRow]);
  const hasFocus = !!(onFocusItem || onFocusAny || onFocusRow);
  const focusTile = hasFocus ? focus : undefined;
  const isTop10 = row.type === 'top10';
  // la misma función de dibujo mientras no cambie lo que usa (FlatList no vuelve a dibujar las tarjetas por nada)
  const renderTile = useCallback<ListRenderItem<Item | Special>>(
    ({ item: x, index }) =>
      isItem(x) ? (
        <PosterTile
          item={x}
          rank={isTop10 ? index + 1 : undefined}
          progress={progressOf?.(x)}
          preferred={focusPref && x.kind + x.id === focusKey}
          onPress={onItem}
          onFocus={focusTile}
        />
      ) : (
        <SpecialTile sp={x} preferred={focusPref && x.kind + x.key === focusKey} onPress={onSpecial} onFocus={focusTile} />
      ),
    [isTop10, progressOf, focusPref, focusKey, onItem, onSpecial, focusTile],
  );
  // filas de tarjetas del mismo ancho (carátulas y «Ver todo»): la lista sabe dónde va cada una sin medirlas
  const uniform = useMemo(() => !isTop10 && row.type === 'poster' && row.items.every(x => isItem(x) || x.kind === 'more'), [row, isTop10]);
  const itemLayout = useMemo(() => {
    if (!uniform) return undefined;
    const len = posterW() + px(16);
    const lead = SIDE;
    return (_: unknown, index: number) => ({ length: len, offset: lead + len * index, index });
  }, [uniform]);
  return (
    <View style={[s.row, { height: rowHeight(row) - px(18) }]}>
      {row.title ? <Text style={s.rowTitle} numberOfLines={1}>{row.title}</Text> : <View style={{ height: px(4) }} />}
      {live ? <FlatList
        horizontal
        data={row.items}
        style={{ height }}
        contentContainerStyle={s.rowContent}
        keyExtractor={(x, i) => {
          const k = isItem(x) ? x.kind + x.id : x.kind + x.key;
          return k + ':' + i + (focusKey && k === focusKey ? ':' + focusRev : '');
        }}
        extraData={focusKey ? focusKey + ':' + focusRev + ':' + focusPref : undefined}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={8}
        // una pantalla de tarjetas a cada lado de lo visible (antes dos): con muchas filas montadas eran cientos de
        // carátulas a la vez y el Fire TV se trababa al recorrerlas
        windowSize={3}
        // las tarjetas que faltan se agregan de a pocas (sin juntar trabajo con la tecla siguiente)
        maxToRenderPerBatch={4}
        getItemLayout={itemLayout}
        renderItem={renderTile}
      /> : null}
    </View>
  );
});

const s = themed(() =>
  StyleSheet.create({
    tile: { borderRadius: px(6), marginRight: px(16), backgroundColor: C.card, overflow: 'hidden', borderWidth: px(4), borderColor: 'transparent', marginTop: px(12) },
    tileF: { borderColor: C.focus, transform: [{ scale: 1.08 }], zIndex: 10 },
    fill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    img: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    fallback: { color: C.sub, fontSize: px(24), textAlign: 'center', padding: px(12) },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(7), backgroundColor: 'rgba(255,255,255,0.35)' },
    barFill: { height: '100%', backgroundColor: C.red },
    rankWrap: { flexDirection: 'row', alignItems: 'flex-end', marginRight: px(8) },
    rank: { color: C.bg, fontSize: px(220), fontWeight: '900', lineHeight: px(230), marginRight: px(-24), textShadowColor: '#9a9a9a', textShadowRadius: px(3), textShadowOffset: { width: 0, height: 0 } },
    plat: { width: px(272), height: px(153), borderRadius: px(10), marginRight: px(22), overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: '#161616', marginTop: px(16) },
    // el logo ocupa la tarjeta con sus propias esquinas redondas (no todos los equipos recortan la imagen con el padre)
    platImg: { width: px(272), height: px(153), borderRadius: px(10) },
    platF: { transform: [{ scale: 1.07 }], zIndex: 10 },
    platRing: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: px(10), borderWidth: px(3), borderColor: 'rgba(255,255,255,0.12)' },
    platRingF: { borderColor: C.focus, borderWidth: px(4) },
    platText: { color: '#fff', fontSize: px(34), fontWeight: '800', textAlign: 'center' },
    genre: { width: px(268), height: px(184), borderRadius: px(10), marginRight: px(18), overflow: 'hidden', borderWidth: px(4), borderColor: 'transparent', marginTop: px(12) },
    genreArt: { position: 'absolute', left: 0, top: 0, width: px(260), height: px(176), opacity: 0.3 },
    genrePosterBox: { position: 'absolute', right: px(10), top: px(16), width: px(96), height: px(144), borderRadius: px(6), overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' },
    genrePoster: { width: px(96), height: px(144) },
    genreText: { position: 'absolute', left: px(14), right: px(14), bottom: px(10), color: '#fff', fontSize: px(30), fontWeight: '800', lineHeight: px(34), textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: px(6), textShadowOffset: { width: 0, height: px(2) } },
    genreTextNarrow: { right: px(118) },
    // «Ver todo» al final de la fila: del tamaño de las carátulas, translúcido (no un bloque sólido) con borde fino
    more: { width: posterW(), height: posterH(), justifyContent: 'center', alignItems: 'center', backgroundColor: alpha(C.text, 0.1), borderColor: alpha(C.text, 0.18) },
    moreText: { color: C.text, fontSize: px(30), fontWeight: '700' },
    row: { marginBottom: px(18) },
    rowTitle: { color: C.text, fontSize: px(34), fontWeight: '700', marginLeft: SIDE, marginBottom: px(4) },
    rowContent: { paddingHorizontal: SIDE, paddingRight: px(200) },
  }),
);
