// Portadas, tarjetas de plataformas/géneros y filas horizontales estilo Netflix.
import React, { memo, useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { isItem, Item, Row, Special } from '../data/catalog';
import { t } from '../lib/i18n';
import { C, px, SIDE, themed } from '../theme';
import { Focusable } from './ui';
import { ChainImage } from './ChainImage';
import { posterSources } from '../lib/images';

// funciones: la escala se conoce al medir la pantalla (después de importar este archivo)
export const posterW = () => px(210);
export const posterH = () => px(315);

export const PosterTile = memo(function PosterTile({
  item,
  onPress,
  onFocus,
  progress,
  rank,
  wide,
}: {
  item: Item;
  onPress: () => void;
  onFocus?: () => void;
  progress?: number;
  rank?: number;
  wide?: boolean;
}) {
  const w = wide ? px(300) : posterW();
  const h = wide ? px(169) : posterH();
  // carátula del panel (o la de TMDB por el título si el servidor no tiene) y, si no carga, la original
  const src = useMemo(() => posterSources(item.kind, item.poster, item.name, item.year, item.tm), [item.kind, item.poster, item.name, item.year, item.tm]);
  return (
    <View style={rank ? s.rankWrap : undefined}>
      {rank ? <Text style={s.rank}>{rank}</Text> : null}
      <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.tile, { width: w, height: h }, f && s.tileF]}>
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

export const SpecialTile = memo(function SpecialTile({ sp, onPress, onFocus }: { sp: Special; onPress: () => void; onFocus?: () => void }) {
  if (sp.kind === 'platform') {
    return (
      // mosaico 16:9 como Roku: la imagen entera (las de plataformas son 16:9), fondo oscuro y borde fino
      <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.plat, f && s.platF]}>
        {sp.image ? <Image source={sp.image} style={s.img} resizeMode="cover" /> : <Text style={[s.platText, { color: sp.color }]}>{sp.label}</Text>}
      </Focusable>
    );
  }
  if (sp.kind === 'genre') {
    return (
      <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.genre, { backgroundColor: sp.color === '#000000' ? '#333' : sp.color }, f && s.tileF]}>
        <Text style={s.genreText}>{sp.label}</Text>
      </Focusable>
    );
  }
  return (
    <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.tile, s.more, f && s.tileF]}>
      <Text style={s.moreText}>{t('Ver todo')} ›</Text>
    </Focusable>
  );
});

// alto de la fila de tarjetas y de la fila completa (título + tarjetas): fijo, así la lista del inicio sabe dónde
// queda cada fila y deja la enfocada siempre arriba (como Roku y Netflix)
export const cardsHeight = (row: Row) => (row.type === 'platform' ? px(190) : row.type === 'genre' ? px(130) : posterH() + px(30));
export const rowHeight = (row: Row) => cardsHeight(row) + (row.title ? px(46) : px(4)) + px(18);

export function RowView({
  row,
  onItem,
  onSpecial,
  onFocusItem,
  onFocusAny,
  progressOf,
}: {
  row: Row;
  onItem: (it: Item) => void;
  onSpecial: (sp: Special) => void;
  onFocusItem?: (it: Item) => void;
  // cualquier tarjeta de la fila (también plataformas, géneros y «Ver todo»)
  onFocusAny?: (x: Item | Special) => void;
  progressOf?: (it: Item) => number | undefined;
}) {
  const height = cardsHeight(row);
  return (
    <View style={[s.row, { height: rowHeight(row) - px(18) }]}>
      {row.title ? <Text style={s.rowTitle} numberOfLines={1}>{row.title}</Text> : <View style={{ height: px(4) }} />}
      <FlatList
        horizontal
        data={row.items}
        style={{ height }}
        contentContainerStyle={s.rowContent}
        keyExtractor={(x, i) => (isItem(x) ? x.kind + x.id : x.kind + x.key) + ':' + i}
        showsHorizontalScrollIndicator={false}
        initialNumToRender={8}
        windowSize={5}
        renderItem={({ item: x, index }) =>
          isItem(x) ? (
            <PosterTile
              item={x}
              rank={row.type === 'top10' ? index + 1 : undefined}
              progress={progressOf?.(x)}
              onPress={() => onItem(x)}
              onFocus={onFocusItem || onFocusAny ? () => (onFocusItem?.(x), onFocusAny?.(x)) : undefined}
            />
          ) : (
            <SpecialTile sp={x} onPress={() => onSpecial(x)} onFocus={onFocusAny ? () => onFocusAny(x) : undefined} />
          )
        }
      />
    </View>
  );
}

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
    plat: { width: px(272), height: px(153), borderRadius: px(10), marginRight: px(22), overflow: 'hidden', justifyContent: 'center', alignItems: 'center', backgroundColor: '#161616', borderWidth: px(3), borderColor: 'rgba(255,255,255,0.12)', marginTop: px(16) },
    platF: { borderColor: C.focus, borderWidth: px(4), transform: [{ scale: 1.07 }], zIndex: 10 },
    platText: { color: '#fff', fontSize: px(34), fontWeight: '800', textAlign: 'center' },
    genre: { width: px(250), height: px(100), borderRadius: px(10), marginRight: px(18), justifyContent: 'center', alignItems: 'center', borderWidth: px(4), borderColor: 'transparent', marginTop: px(10) },
    genreText: { color: '#fff', fontSize: px(30), fontWeight: '800' },
    more: { width: posterW(), height: posterH(), justifyContent: 'center', alignItems: 'center', backgroundColor: C.card },
    moreText: { color: C.text, fontSize: px(30), fontWeight: '700' },
    row: { marginBottom: px(18) },
    rowTitle: { color: C.text, fontSize: px(34), fontWeight: '700', marginLeft: SIDE, marginBottom: px(4) },
    rowContent: { paddingHorizontal: SIDE, paddingRight: px(200) },
  }),
);
