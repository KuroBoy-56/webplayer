// Inicio, Series y Películas: portada grande + filas.
import React, { useMemo } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem, openSpecial, playMovie } from '../actions';
import { Button, Message, Spinner } from '../components/ui';
import { RowView } from '../components/Tiles';
import { catalog, Item, Row } from '../data/catalog';
import { digits } from '../lib/util';
import { useNav } from '../nav';
import { getState, isFav, Progress, toggleFav, useAppState } from '../state';
import { alpha, C, px, SIDE, themed } from '../theme';

// fila "Continuar viendo" a partir del progreso guardado en el panel
function continueRow(progress: Progress[], only?: 'vod' | 'series'): Row | null {
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const p of progress) {
    if (p.type === 'movie' && only !== 'series') {
      const it = catalog.find('vod', digits(p.id)) || null;
      if (it && !seen.has('v' + it.id)) {
        seen.add('v' + it.id);
        items.push(it);
      }
    } else if ((p.type === 'episode' || (p.type as string) === 'series') && only !== 'vod') {
      // 'series' lo guardan otras apps (Windows) con el id de la serie
      const it = catalog.find('series', digits(p.type === 'episode' ? p.seriesId : p.seriesId || p.id));
      if (it && !seen.has('s' + it.id)) {
        seen.add('s' + it.id);
        items.push(it);
      }
    }
    if (items.length >= 30) break;
  }
  return items.length ? { title: 'Continuar viendo', type: 'poster', items } : null;
}

function favRow(): Row | null {
  const items: Item[] = [];
  for (const f of getState().favorites) {
    if (f.type === 'live') continue;
    const it = catalog.find(f.type === 'movie' ? 'vod' : 'series', digits(f.id));
    if (it) items.push(it);
    if (items.length >= 30) break;
  }
  return items.length ? { title: 'Mi lista', type: 'poster', items } : null;
}

function Billboard({ hero }: { hero: Item }) {
  const nav = useNav();
  const st = useAppState();
  const fav = isFav(hero.kind, hero.id);
  void st.rev;
  return (
    <View style={s.hero}>
      {hero.backdrop || hero.poster ? <Image source={{ uri: hero.backdrop || hero.poster }} style={s.heroImg} resizeMode="cover" /> : null}
      {/* degradado teñido con el fondo del distribuidor */}
      <Image source={require('../../assets/image/grad_bottom.png')} style={[s.heroGrad, { tintColor: C.bg }]} resizeMode="stretch" />
      <View style={s.heroShade} />
      <View style={s.heroText}>
        <Text style={s.heroKind}>{hero.kind === 'series' ? 'S E R I E' : 'P E L Í C U L A'}</Text>
        <Text style={s.heroTitle} numberOfLines={2}>
          {hero.name}
        </Text>
        <Text style={s.heroMeta}>
          {[hero.year, hero.rating > 0 ? '★ ' + hero.rating.toFixed(1) : ''].filter(Boolean).join('   ')}
        </Text>
        {hero.plot ? (
          <Text style={s.heroPlot} numberOfLines={3}>
            {hero.plot}
          </Text>
        ) : null}
        <View style={s.heroBtns}>
          <Button
            label="Reproducir"
            icon="▶"
            primary
            preferred
            onPress={() => (hero.kind === 'vod' ? playMovie(nav, hero, hero.ext) : openItem(nav, hero))}
          />
          <Button label="Más información" icon="ⓘ" onPress={() => openItem(nav, hero)} />
          <Button label={fav ? 'En mi lista' : 'Mi lista'} icon={fav ? '✓' : '+'} last onPress={() => toggleFav(hero.kind, hero.id, hero.name, hero.poster, hero.cat)} />
        </View>
      </View>
    </View>
  );
}

export default function Browse({ section }: { section: 'home' | 'series' | 'movies' }) {
  const nav = useNav();
  const st = useAppState();
  const ready = section === 'home' ? st.loaded.vod || st.loaded.series : section === 'series' ? st.loaded.series : st.loaded.vod;

  // las filas del catálogo solo se rehacen cuando llega una lista nueva
  const base = useMemo(() => {
    if (!ready) return { rows: [] as Row[], hero: null as Item | null };
    return section === 'home' ? catalog.home() : catalog.browse(section === 'series' ? 'series' : 'vod');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, section, st.catalogRev]);

  const rows = useMemo(() => {
    const extra: Row[] = [];
    const only = section === 'series' ? 'series' : section === 'movies' ? 'vod' : undefined;
    const cont = continueRow(st.progress, only);
    if (cont) extra.push(cont);
    if (section === 'home') {
      const f = favRow();
      if (f) extra.push(f);
    }
    return [...extra, ...base.rows];
  }, [base, st.progress, st.favorites, section]);

  const progressOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of st.progress) {
      if (p.duration > 0) {
        const key = p.type === 'movie' ? 'vod' + digits(p.id) : 'series' + digits(p.type === 'episode' ? p.seriesId : p.seriesId || p.id);
        if (!map.has(key)) map.set(key, p.position / p.duration);
      }
    }
    return (it: Item) => map.get(it.kind + it.id);
  }, [st.progress]);

  if (!ready) return <Spinner label={st.error || 'Cargando el catálogo…'} />;
  if (!rows.length) return <Message text="No hay contenido para mostrar." />;

  return (
    <FlatList
      data={rows}
      keyExtractor={(r, i) => r.title + i}
      ListHeaderComponent={base.hero ? <Billboard hero={base.hero} /> : <View style={{ height: px(130) }} />}
      initialNumToRender={4}
      windowSize={5}
      renderItem={({ item }) => (
        <RowView row={item} onItem={it => openItem(nav, it)} onSpecial={sp => openSpecial(nav, sp)} progressOf={progressOf} />
      )}
      contentContainerStyle={{ paddingBottom: px(120) }}
    />
  );
}

const s = themed(() =>
  StyleSheet.create({
    hero: { height: px(840), marginBottom: px(-120) },
    heroImg: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    heroGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(420) },
    heroShade: { position: 'absolute', left: 0, top: 0, bottom: 0, width: px(1100), backgroundColor: alpha(C.bg, 0.5) },
    heroText: { position: 'absolute', left: SIDE, top: px(220), width: px(980) },
    heroKind: { color: C.red, fontSize: px(24), fontWeight: '800', marginBottom: px(8) },
    heroTitle: { color: C.text, fontSize: px(76), fontWeight: '900', lineHeight: px(84) },
    heroMeta: { color: C.green, fontSize: px(28), fontWeight: '700', marginTop: px(12) },
    heroPlot: { color: C.text, fontSize: px(28), lineHeight: px(38), marginTop: px(16) },
    heroBtns: { flexDirection: 'row', marginTop: px(30) },
  }),
);
