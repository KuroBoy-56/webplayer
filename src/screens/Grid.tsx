// "Ver todo": cuadrícula de una plataforma, género, categoría o lo más reciente.
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { openItem } from '../actions';
import { Focusable, Message } from '../components/ui';
import { POSTER_H, PosterTile } from '../components/Tiles';
import { catalog, Item } from '../data/catalog';
import { fold } from '../lib/util';
import { useNav } from '../nav';
import { useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';

export const COLS = 7;

export function ItemGrid({ items, header, channels }: { items: Item[]; header?: React.ReactElement; channels?: boolean }) {
  const nav = useNav();
  const rowH = POSTER_H + px(40);
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

export default function Grid({ title, mode, keyName, kind }: { title: string; mode: 'cat' | 'platform' | 'genre' | 'recent'; keyName: string; kind?: 'vod' | 'series' }) {
  const st = useAppState();
  const items = useMemo(() => catalog.grid(mode, keyName, kind), [mode, keyName, kind, st.catalogRev]);
  const name = mode === 'cat' && kind ? catalog.k[kind]?.cats.find(c => c.id === keyName)?.name || title : title;
  const canSearch = mode === 'platform';
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<TextInput>(null);
  const needle = fold(q.trim());
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
      <View style={s.head}>
        <Text style={s.title} numberOfLines={1}>
          {name} <Text style={s.count}>{shown.length ? '· ' + shown.length + ' títulos' : ''}</Text>
        </Text>
        {canSearch ? (
          <View style={s.searchBox}>
            {searching ? (
              <TextInput
                ref={input}
                style={s.input}
                value={q}
                onChangeText={setQ}
                placeholder={'Buscar en ' + name + '…'}
                placeholderTextColor={C.dim}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
            ) : null}
            <Focusable onPress={toggle} style={f => [s.magBtn, f && s.magBtnF]}>
              {f => (q ? <Text style={[s.clear, f && s.clearF]}>✕</Text> : <MagnifierIcon color={f ? '#000' : '#fff'} />)}
            </Focusable>
          </View>
        ) : null}
      </View>
      {shown.length ? (
        <ItemGrid items={shown} />
      ) : (
        <Message text={needle ? 'No hay títulos que coincidan con «' + q.trim() + '».' : 'No hay títulos en esta sección.'} />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, paddingTop: px(60) },
    head: { flexDirection: 'row', alignItems: 'center', marginHorizontal: SIDE, marginBottom: px(10), minHeight: px(80) },
    title: { flex: 1, color: '#fff', fontSize: px(52), fontWeight: '800' },
    searchBox: { flexDirection: 'row', alignItems: 'center', marginLeft: px(20) },
    input: { width: px(520), height: px(72), backgroundColor: '#333', borderRadius: px(6), color: '#fff', fontSize: px(30), paddingHorizontal: px(24), marginRight: px(14) },
    magBtn: { width: px(72), height: px(72), borderRadius: px(36), alignItems: 'center', justifyContent: 'center', borderWidth: px(3), borderColor: 'transparent' },
    magBtnF: { backgroundColor: '#fff', borderColor: '#fff', transform: [{ scale: 1.1 }] },
    mag: { width: px(40), height: px(40) },
    magRing: { position: 'absolute', left: 0, top: 0, width: px(28), height: px(28), borderRadius: px(14), borderWidth: px(4) },
    magHandle: { position: 'absolute', left: px(22), top: px(28), width: px(16), height: px(5), borderRadius: px(3), transform: [{ rotate: '45deg' }] },
    clear: { color: '#fff', fontSize: px(34), fontWeight: '700' },
    clearF: { color: '#000' },
    count: { color: C.sub, fontSize: px(30), fontWeight: '400' },
  }),
);
