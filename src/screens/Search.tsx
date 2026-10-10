// Buscar en películas, series y canales.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { catalog, Item } from '../data/catalog';
import { useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';
import { ItemGrid } from './Grid';

export default function Search() {
  const st = useAppState();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setItems(q.trim().length >= 2 ? catalog.search(q) : []), 350);
    return () => clearTimeout(t);
  }, [q, st.catalogRev]);

  return (
    <View style={s.root}>
      <TextInput
        style={s.input}
        value={q}
        onChangeText={setQ}
        placeholder="Títulos, series, canales…"
        placeholderTextColor={C.dim}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {q.trim().length >= 2 && !items.length ? <Text style={s.none}>No hay resultados para «{q.trim()}»</Text> : null}
      <ItemGrid items={items} channels />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: px(130) },
    input: { marginHorizontal: SIDE, height: px(84), backgroundColor: C.card, borderRadius: px(8), color: C.text, fontSize: px(34), paddingHorizontal: px(28), marginBottom: px(20) },
    none: { color: C.sub, fontSize: px(28), marginLeft: SIDE },
  }),
);
