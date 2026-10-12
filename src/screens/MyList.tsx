// Mi lista: favoritos (películas, series y canales) sincronizados con el panel.
import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Message } from '../components/ui';
import { catalog, Item } from '../data/catalog';
import { digits } from '../lib/util';
import { useAppState } from '../state';
import { C, px, themed } from '../theme';
import { ItemGrid } from './Grid';

export default function MyList() {
  const st = useAppState();
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const f of st.favorites) {
      const kind = f.type === 'movie' ? 'vod' : f.type === 'series' ? 'series' : 'live';
      const it = catalog.find(kind, digits(f.id));
      if (it) out.push(it);
      else if (f.title) out.push({ kind, id: digits(f.id), name: f.title, poster: f.poster, backdrop: '', plot: '', cat: f.categoryId, ext: '', rating: 0, year: '', epg: '', num: '' });
    }
    return out;
  }, [st.favorites, st.catalogRev]);

  if (st.demo) return <Message text="Mi lista no está disponible en la DEMO." />;
  if (!items.length) return <Message text="Tu lista está vacía. Agrega películas, series o canales con «Mi lista»." />;
  return <ItemGrid items={items} header={<Text style={s.title}>Mi lista</Text>} />;
}

const s = themed(() =>
  StyleSheet.create({
    title: { color: C.text, fontSize: px(48), fontWeight: '800', marginTop: px(130), marginBottom: px(10) },
  }),
);
