// "Ver todo": cuadrícula de una plataforma, género, categoría o lo más reciente.
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { Message } from '../components/ui';
import { POSTER_H, PosterTile } from '../components/Tiles';
import { catalog, Item } from '../data/catalog';
import { useNav } from '../nav';
import { useAppState } from '../state';
import { C, px, SIDE } from '../theme';

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

export default function Grid({ title, mode, keyName, kind }: { title: string; mode: 'cat' | 'platform' | 'genre' | 'recent'; keyName: string; kind?: 'vod' | 'series' }) {
  const st = useAppState();
  const items = useMemo(() => catalog.grid(mode, keyName, kind), [mode, keyName, kind, st.catalogRev]);
  const name = mode === 'cat' && kind ? catalog.k[kind]?.cats.find(c => c.id === keyName)?.name || title : title;
  return (
    <View style={s.root}>
      <Text style={s.title}>
        {name} <Text style={s.count}>{items.length ? '· ' + items.length + ' títulos' : ''}</Text>
      </Text>
      {items.length ? <ItemGrid items={items} /> : <Message text="No hay títulos en esta sección." />}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: px(60) },
  title: { color: '#fff', fontSize: px(52), fontWeight: '800', marginLeft: SIDE, marginBottom: px(10) },
  count: { color: C.sub, fontSize: px(30), fontWeight: '400' },
});
