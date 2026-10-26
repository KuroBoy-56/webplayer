// "Ver todo": cuadrícula de una plataforma, género, categoría o lo más reciente.
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { openItem } from '../actions';
import { Focusable, Message } from '../components/ui';
import { posterH, PosterTile } from '../components/Tiles';
import { catalog, Item } from '../data/catalog';
import { continueItems, favItems } from '../data/personal';
import { fold } from '../lib/util';
import { useNav } from '../nav';
import { useAppState } from '../state';
import { t } from '../lib/i18n';
import { alpha, C, px, SIDE, themed } from '../theme';

export const COLS = 7;

export function ItemGrid({ items, header, channels }: { items: Item[]; header?: React.ReactElement; channels?: boolean }) {
  const nav = useNav();
  const rowH = posterH() + px(40);
  return (
    <FlatList
      data={items}
      numColumns={COLS}
      key={COLS}
      keyExtractor={(it, i) => it.kind + it.id + ':' + i}
      ListHeaderComponent={header}
      contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(120) }}
      initialNumToRender={21}
      windowSize={5}
      getItemLayout={header ? undefined : (_, i) => ({ length: rowH, offset: rowH * i, index: i })}
      renderItem={({ item }) => <PosterTile item={item} onPress={() => openItem(nav, item, channels ? items.filter(x => x.kind === 'live') : undefined)} />}
    />
  );
}

// Lupa dibujada con vistas (no depende de fuentes de iconos ni emojis).
function MagnifierIcon({ color }: { color: string }) {
  return (
    <View style={s.mag}>
      <View style={[s.magRing, { borderColor: color }]} />
      <View style={[s.magHandle, { backgroundColor: color }]} />
    </View>
  );
}

export default function Grid({ title, mode, keyName, kind }: { title: string; mode: 'cat' | 'platform' | 'genre' | 'recent' | 'continue' | 'mylist'; keyName: string; kind?: 'vod' | 'series' }) {
  const st = useAppState();
  // «Ver todo» de Continuar viendo y de Mi lista: lo guardado en el panel, del más reciente al más antiguo
  const items = useMemo(
    () => (mode === 'continue' ? continueItems(st.progress, kind, 3000) : mode === 'mylist' ? favItems(st.favorites, 3000) : catalog.grid(mode, keyName, kind)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, keyName, kind, st.catalogRev, mode === 'continue' ? st.progress : mode === 'mylist' ? st.favorites : null],
  );
  const name = mode === 'cat' && kind ? catalog.k[kind]?.cats.find(c => c.id === keyName)?.name || title : title;
  const canSearch = mode === 'platform';
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<TextInput>(null);
  const needle = fold(q.trim());
  // de fondo, un destacado de la lista si tiene fondo propio; en plataformas, fondo liso (antes quedaba detrás la última
  // portada de Inicio, fija, que no tenía nada que ver con la plataforma)
  const banner = useMemo(() => (mode === 'platform' ? '' : items.slice(0, 40).find(it => it.backdrop)?.backdrop || ''), [items, mode]);
  const shown = useMemo(() => (needle ? items.filter(it => fold(it.name).includes(needle)) : items), [items, needle]);

  const toggle = () => {
    if (!searching) {
      setSearching(true);
      setTimeout(() => input.current?.focus(), 50);
    } else if (q) {
      setQ('');
      input.current?.focus();
    } else {
      setSearching(false);
    }
  };

  return (
    <View style={s.root}>
      {banner ? (
        <View style={s.banner} pointerEvents="none">
          <Image source={{ uri: banner }} style={s.bannerImg} resizeMode="cover" />
          <Image source={require('../../assets/image/grad_bottom.png')} style={[s.bannerGrad, { tintColor: C.bg }]} resizeMode="stretch" />
        </View>
      ) : null}
      <View style={s.head}>
        <Text style={s.title} numberOfLines={1}>
          {name} <Text style={s.count}>{shown.length ? '· ' + t('{n} títulos', { n: shown.length }) : ''}</Text>
        </Text>
        {canSearch ? (
          <View style={s.searchBox}>
            {searching ? (
              <TextInput
                ref={input}
                style={s.input}
                value={q}
                onChangeText={setQ}
                placeholder={t('Buscar en {x}…', { x: name })}
                placeholderTextColor={C.dim}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
            ) : null}
            <Focusable onPress={toggle} style={f => [s.magBtn, f && s.magBtnF]}>
              {f => (q ? <Text style={[s.clear, f && s.clearF]}>✕</Text> : <MagnifierIcon color={f ? C.onFocus : C.text} />)}
            </Focusable>
          </View>
        ) : null}
      </View>
      {shown.length ? (
        <ItemGrid items={shown} />
      ) : (
        <Message text={needle ? t('No hay títulos que coincidan con «{q}».', { q: q.trim() }) : t('No hay títulos en esta sección.')} />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, paddingTop: px(60) },
    banner: { position: 'absolute', left: 0, top: 0, right: 0, height: px(620), opacity: 0.45 },
    bannerImg: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    bannerGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(420) },
    head: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SIDE, marginBottom: px(10), minHeight: px(80) },
    title: { flex: 1, color: C.text, fontSize: px(52), fontWeight: '800' },
    searchBox: { flexDirection: 'row', alignItems: 'center', marginLeft: px(20) },
    input: { width: px(520), height: px(72), backgroundColor: C.card, borderRadius: px(8), color: C.text, fontSize: px(30), paddingHorizontal: px(24), marginRight: px(14) },
    magBtn: { width: px(72), height: px(72), borderRadius: px(36), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: alpha(C.text, 0.2), backgroundColor: alpha(C.text, 0.15) },
    magBtnF: { backgroundColor: C.focus, borderColor: C.focus, transform: [{ scale: 1.1 }] },
    mag: { width: px(40), height: px(40) },
    magRing: { position: 'absolute', left: 0, top: 0, width: px(28), height: px(28), borderRadius: px(14), borderWidth: px(4) },
    magHandle: { position: 'absolute', left: px(22), top: px(28), width: px(16), height: px(5), borderRadius: px(3), transform: [{ rotate: '45deg' }] },
    clear: { color: C.text, fontSize: px(34), fontWeight: '700' },
    clearF: { color: C.onFocus },
    count: { color: C.sub, fontSize: px(30), fontWeight: '400' },
  }),
);
