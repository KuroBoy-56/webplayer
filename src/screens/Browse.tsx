// Inicio, Series y Películas como Roku y Netflix: la portada grande queda fija arriba y solo se mueven las filas.
// Con el foco en los botones de la portada (Reproducir / Más información / Mi lista) las filas asoman abajo; al bajar
// a las filas, la portada muestra el título enfocado (fondo, nombre, año y sinopsis) y la fila enfocada queda
// siempre en el mismo lugar, con las de abajo asomando. Arriba desde la primera fila vuelve a los botones.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem, openSpecial, playMovie } from '../actions';
import { Button, Message, Spinner } from '../components/ui';
import { RowView, rowHeight } from '../components/Tiles';
import { ChainImage } from '../components/ChainImage';
import { backdropSources, posterSources } from '../lib/images';
import { catalog, isItem, Item, Row, Special } from '../data/catalog';
import { continueItems, favItems } from '../data/personal';
import { digits } from '../lib/util';
import { useNav } from '../nav';
import { isFav, toggleFav, useAppState } from '../state';
import { t } from '../lib/i18n';
import { brandInitial, features, useBrandRev } from '../lib/tenant';
import { alpha, C, px, SIDE, themed } from '../theme';

// última imagen de la portada: queda de fondo mientras carga la siguiente (nunca la pantalla en negro)
let lastBanner = '';
export const bannerUri = () => lastBanner;

// dónde empiezan las filas: con los botones de la portada (asoman) o recorriéndolas (la enfocada arriba)
const ROWS_HERO = 818;
const ROWS_IN = 560;

type Info = { item: Item | null; title?: string; plot?: string };

function Billboard({ info, compact }: { info: Info; compact: boolean }) {
  const it = info.item;
  const art = it?.backdrop || '';
  const artSrc = useMemo(() => (art ? backdropSources(art) : []), [art]);
  const sideSrc = useMemo(() => (it && !art ? posterSources(it.kind, it.poster, it.name, it.year) : []), [it, art]);
  // sin fondo propio queda el último (nunca negro) y la carátula va a la derecha
  const [under, setUnder] = useState(lastBanner);
  useEffect(() => {
    if (art) {
      lastBanner = art;
      setUnder(art);
    }
  }, [art]);
  const title = info.title ?? it?.name ?? '';
  const plot = info.plot ?? it?.plot ?? '';
  return (
    <View style={s.hero} pointerEvents="none">
      {under && under !== art ? <Image source={{ uri: under }} style={s.heroImg} resizeMode="cover" /> : null}
      {art ? <ChainImage sources={artSrc} style={s.heroImg} resizeMode="cover" /> : null}
      <Image source={require('../../assets/image/grad_bottom.png')} style={[s.heroGrad, { tintColor: C.bg }]} resizeMode="stretch" />
      <Image source={require('../../assets/image/grad_left.png')} style={[s.heroShade, { tintColor: C.bg }]} resizeMode="stretch" />
      {sideSrc.length ? <ChainImage sources={sideSrc} style={[s.side, compact && s.sideCompact]} resizeMode="cover" /> : null}
      <View style={[s.heroText, compact && s.heroTextCompact]}>
        {it ? (
          <Text style={s.heroKind}>
            {/* la "N" de Netflix: la inicial de la marca en su color de acento */}
            <Text style={s.heroMark}>{brandInitial()}</Text>
            {'  ' + (it.kind === 'series' ? t('SERIE') : it.kind === 'live' ? t('EN VIVO') : t('PELÍCULA')).split('').join(' ')}
          </Text>
        ) : null}
        <Text style={[s.heroTitle, compact && s.heroTitleCompact]} numberOfLines={2}>
          {title}
        </Text>
        {it ? <Text style={s.heroMeta}>{[it.year, it.rating > 0 ? '★ ' + it.rating.toFixed(1) : ''].filter(Boolean).join('   ')}</Text> : null}
        {plot ? (
          <Text style={s.heroPlot} numberOfLines={compact ? 2 : 3}>
            {plot}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function Browse({ section }: { section: 'home' | 'series' | 'movies' }) {
  const nav = useNav();
  const st = useAppState();
  // el distribuidor puede no separar su contenido por plataformas
  const brandRev = useBrandRev();
  const platforms = features().platforms;
  const ready = section === 'home' ? st.loaded.vod || st.loaded.series : section === 'series' ? st.loaded.series : st.loaded.vod;

  // las filas del catálogo solo se rehacen cuando llega una lista nueva
  const base = useMemo(() => {
    if (!ready) return { rows: [] as Row[], hero: null as Item | null };
    return section === 'home' ? catalog.home(platforms) : catalog.browse(section === 'series' ? 'series' : 'vod');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, section, st.catalogRev, platforms, brandRev]);

  // Continuar viendo y Mi lista (del panel), después de las plataformas, con «Ver todo» al final
  const rows = useMemo(() => {
    const extra: Row[] = [];
    const only = section === 'series' ? 'series' : section === 'movies' ? 'vod' : undefined;
    const cont = continueItems(st.progress, only);
    if (cont.length) extra.push({ title: t('Continuar viendo'), type: 'poster', items: [...cont, { kind: 'more', key: 'continue', label: t('Ver todo'), color: '', extra: 'continue' }] });
    if (section === 'home') {
      const f = favItems(st.favorites);
      if (f.length) extra.push({ title: t('Mi lista'), type: 'poster', items: [...f, { kind: 'more', key: 'mylist', label: t('Ver todo'), color: '', extra: 'mylist' }] });
    }
    const out = [...base.rows];
    const at = out.length && out[0].type === 'platform' ? 1 : 0;
    out.splice(at, 0, ...extra);
    return out;
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

  const hero = base.hero;
  const [inRows, setInRows] = useState(false);
  const [rowIdx, setRowIdx] = useState(0);
  const [info, setInfo] = useState<Info>({ item: hero });
  useEffect(() => setInfo({ item: hero }), [hero]);
  const list = useRef<FlatList<Row>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // offset de cada fila (alto fijo por tipo)
  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const r of rows) {
      out.push(y);
      y += rowHeight(r);
    }
    return out;
  }, [rows]);

  // foco en una tarjeta: su fila queda arriba y la portada muestra lo enfocado cuando el foco se detiene
  const onFocusAt = useCallback(
    (i: number, x: Item | Special) => {
      setInRows(true);
      setRowIdx(i);
      list.current?.scrollToOffset({ offset: offsets[i] || 0, animated: true });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (isItem(x)) setInfo({ item: x });
        else if (x.kind === 'platform') setInfo({ item: null, title: x.label, plot: t('Todo el contenido de {x}: películas y series detectadas en tus categorías.', { x: x.label }) });
        else if (x.kind === 'genre') setInfo({ item: null, title: x.label, plot: t('Películas y series de {x}.', { x: x.label }) });
        else setInfo({ item: null, title: rows[i]?.title || x.label, plot: t('Ver todo el contenido de esta fila.') });
      }, 120);
    },
    [offsets, rows],
  );

  // los botones de la portada: vuelve el destacado y las filas bajan
  const toHero = () => {
    if (timer.current) clearTimeout(timer.current);
    setInRows(false);
    setRowIdx(0);
    setInfo({ item: hero });
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };

  if (!ready) return <Spinner label={st.error || t('Cargando el catálogo…')} />;
  if (!rows.length) return <Message text={t('No hay contenido para mostrar.')} />;

  const fav = hero ? isFav(hero.kind, hero.id) : false;
  // arriba desde la primera fila vuelve a los botones; desde las demás, a la fila de arriba
  const btnsFocusable = !inRows || rowIdx === 0;

  return (
    <View style={s.root}>
      <Billboard info={inRows ? info : { item: hero }} compact={inRows} />
      {hero ? (
        <View style={[s.btns, inRows && s.btnsHidden]}>
          <Button
            label={t('Reproducir')}
            icon="▶"
            primary
            preferred
            disabled={!btnsFocusable}
            onFocus={toHero}
            onPress={() => (hero.kind === 'vod' ? playMovie(nav, hero, hero.ext) : openItem(nav, hero))}
          />
          <Button label={t('Más información')} icon="ⓘ" disabled={!btnsFocusable} onFocus={toHero} onPress={() => openItem(nav, hero)} />
          <Button
            label={fav ? t('En mi lista') : t('Mi lista')}
            icon={fav ? '✓' : '+'}
            last
            disabled={!btnsFocusable}
            onFocus={toHero}
            onPress={() => toggleFav(hero.kind, hero.id, hero.name, hero.poster, hero.cat)}
          />
        </View>
      ) : null}
      <View style={[s.rowsBox, { top: px(inRows || !hero ? ROWS_IN : ROWS_HERO) }]}>
        <FlatList
          ref={list}
          data={rows}
          keyExtractor={(r, i) => r.title + i}
          getItemLayout={(_, i) => ({ length: rowHeight(rows[i]), offset: offsets[i] || 0, index: i })}
          initialNumToRender={4}
          windowSize={5}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <RowView row={item} onItem={it => openItem(nav, it)} onSpecial={sp => openSpecial(nav, sp)} onFocusAny={x => onFocusAt(index, x)} progressOf={progressOf} />
          )}
          contentContainerStyle={{ paddingBottom: px(600) }}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    hero: { position: 'absolute', left: 0, top: 0, right: 0, height: px(1080) },
    heroImg: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    heroGrad: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(620) },
    heroShade: { position: 'absolute', left: 0, top: 0, bottom: 0, width: px(1400) },
    side: { position: 'absolute', right: SIDE, top: px(150), width: px(427), height: px(640), borderRadius: px(8) },
    sideCompact: { top: px(120), width: px(260), height: px(390) },
    heroText: { position: 'absolute', left: SIDE, top: px(230), width: px(980) },
    heroTextCompact: { top: px(140), width: px(1100) },
    heroKind: { color: C.sub, fontSize: px(24), fontWeight: '800', marginBottom: px(8) },
    heroMark: { color: C.red, fontSize: px(44), fontWeight: '900' },
    heroTitle: { color: C.text, fontSize: px(76), fontWeight: '900', lineHeight: px(84) },
    heroTitleCompact: { fontSize: px(58), lineHeight: px(66) },
    heroMeta: { color: C.green, fontSize: px(28), fontWeight: '700', marginTop: px(12) },
    heroPlot: { color: C.text, fontSize: px(28), lineHeight: px(38), marginTop: px(16) },
    btns: { position: 'absolute', left: SIDE, top: px(700), flexDirection: 'row' },
    // recorriendo las filas los botones no se ven (siguen arriba para volver a ellos desde la primera fila)
    btnsHidden: { top: px(440), opacity: 0 },
    rowsBox: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  }),
);
