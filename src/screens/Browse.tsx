// Inicio, Series y Películas como Roku y Netflix: la portada grande queda fija arriba y solo se mueven las filas.
// Con el foco en los botones de la portada (Reproducir / Más información / Mi lista) las filas asoman abajo; al bajar
// a las filas, la portada muestra el título enfocado (fondo, nombre, año y sinopsis) y la fila enfocada queda
// siempre en el mismo lugar, con las de abajo asomando. Arriba desde la primera fila vuelve a los botones.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openItem, openSpecial, playMovie } from '../actions';
import { Button, Message, Spinner } from '../components/ui';
import { RowView, rowHeight } from '../components/Tiles';
import { ChainImage } from '../components/ChainImage';
import { backdropSources, posterSources } from '../lib/images';
import { catalog, isItem, Item, Row, Special } from '../data/catalog';
import { continueItems, favItems } from '../data/personal';
import { Art, heroArt, heroArtList, savedArt } from '../data/heroart';
import { digits } from '../lib/util';
import { idleStep, onFocusWin, Win } from '../lib/rowwindow';
import { useNav } from '../nav';
import { progressEpisodeId, progressSeriesId, resumePosition, getState, isFav, toggleFav, useAppState } from '../state';
import { episodeUrl, movieUrl } from '../api/xtream';
import { idxWarmList } from '../player/idxwarm';
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

// el título con lo que se encontró para la portada (fondo, sinopsis, año y nota si el servidor no los tenía)
const withArt = (x: Item, a: Art): Item => ({
  ...x,
  backdrop: x.backdrop || a.backdrop,
  plot: x.plot || a.plot,
  year: x.year || a.year,
  rating: x.rating || Number(a.rating) || 0,
});

function Billboard({ info, compact }: { info: Info; compact: boolean }) {
  const it = info.item;
  const art = it?.backdrop || '';
  const artSrc = useMemo(() => (art ? backdropSources(art) : []), [art]);
  const sideSrc = useMemo(() => (it && !art ? posterSources(it.kind, it.poster, it.name, it.year, it.tm) : []), [it, art]);
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
      {/* sin fondo propio: la carátula del mismo título agrandada y oscurecida (antes quedaba el fondo del último título
          enfocado, que no tenía nada que ver); el último fondo solo para plataformas, géneros y «Ver todo» */}
      {under && under !== art && !it ? <Image source={{ uri: under }} style={s.heroImg} resizeMode="cover" /> : null}
      {!art && sideSrc.length ? (
        <View style={s.heroDim}>
          <ChainImage sources={sideSrc} style={s.heroImg} resizeMode="cover" blurRadius={18} />
        </View>
      ) : null}
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

export default function Browse({ section, active = true }: { section: 'home' | 'series' | 'movies'; active?: boolean }) {
  const nav = useNav();
  const st = useAppState();
  // el distribuidor puede no separar su contenido por plataformas
  const brandRev = useBrandRev();
  const platforms = features().platforms;
  const ready = section === 'home' ? st.loaded.vod || st.loaded.series : section === 'series' ? st.loaded.series : st.loaded.vod;
  // con otra pantalla encima (ficha, reproductor) Continuar viendo y Mi lista quedan como estaban: el reproductor guarda
  // el avance cada 30 s y cada guardado volvía a dibujar todas las filas de abajo; al volver se ponen al día
  const kept = useRef({ progress: st.progress, favorites: st.favorites });
  if (active) kept.current = { progress: st.progress, favorites: st.favorites };
  const { progress, favorites } = kept.current;

  // las filas del catálogo solo se rehacen cuando llega una lista nueva
  const base = useMemo(() => {
    if (!ready) return { rows: [] as Row[], hero: null as Item | null, heroes: [] as Item[] };
    return section === 'home' ? catalog.home(platforms) : catalog.browse(section === 'series' ? 'series' : 'vod');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, section, st.catalogRev, platforms, brandRev]);

  // Continuar viendo y Mi lista (del panel) solo en Inicio, después de las plataformas, con «Ver todo» al final
  const rows = useMemo(() => {
    const extra: Row[] = [];
    if (section === 'home') {
      const cont = continueItems(progress);
      if (cont.length) extra.push({ title: t('Continuar viendo'), type: 'poster', items: [...cont, { kind: 'more', key: 'continue', label: t('Ver todo'), color: '', extra: 'continue' }] });
      const f = favItems(favorites);
      if (f.length) extra.push({ title: t('Mi lista'), type: 'poster', items: [...f, { kind: 'more', key: 'mylist', label: t('Ver todo'), color: '', extra: 'mylist' }] });
    }
    const out = [...base.rows];
    const at = out.length && out[0].type === 'platform' ? 1 : 0;
    out.splice(at, 0, ...extra);
    return out;
  }, [base, progress, favorites, section]);

  // los índices de los primeros de Continuar viendo se leen en segundo plano mientras se mira el inicio (idxwarm.ts):
  // al abrirlos solo falta pedir el video (también si se empezaron en otro equipo)
  useEffect(() => {
    if (section !== 'home' || !active) return;
    const s = getState().session;
    if (!s) return;
    const urls: string[] = [];
    for (const p of progress) {
      if (urls.length >= 4) break;
      if (!resumePosition(p)) continue;
      const ext = (/\.([a-z0-9]{2,4})(?:\?|$)/i.exec(p.url || '') || [])[1] || '';
      if (p.type === 'movie') {
        const it = catalog.find('vod', digits(p.id));
        if (it) urls.push(movieUrl(s, it.id, it.ext || ext));
      } else {
        const episode = progressEpisodeId(p);
        if (episode) urls.push(episodeUrl(s, episode, ext));
      }
    }
    idxWarmList(urls, Number(s.max) || 0);
  }, [section, active, progress]);

  const progressOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of progress) {
      if (p.duration > 0) {
        const key = p.type === 'movie' ? 'vod' + digits(p.id) : 'series' + progressSeriesId(p);
        if (!map.has(key)) map.set(key, p.position / p.duration);
      }
    }
    return (it: Item) => map.get(it.kind + it.id);
  }, [progress]);

  // el destacado también busca su fondo (servidor y luego TMDB), como los títulos enfocados
  const [heroArtOf, setHeroArtOf] = useState<{ id: string; art: Art } | null>(null);
  useEffect(() => {
    const h = base.hero;
    if (!active || !h || h.backdrop || (h.kind !== 'vod' && h.kind !== 'series')) return;
    const known = savedArt(h);
    if (known) return setHeroArtOf({ id: h.kind + h.id, art: known });
    let live = true;
    heroArt(h, a => live && a && setHeroArtOf({ id: h.kind + h.id, art: a }));
    return () => {
      live = false;
    };
  }, [base.hero, active]);
  const firstHero = useMemo(() => {
    const h = base.hero;
    return h && heroArtOf && heroArtOf.id === h.kind + h.id ? withArt(h, heroArtOf.art) : h;
  }, [base.hero, heroArtOf]);
  // destacados que van pasando cada 8 s (como Roku): hasta 6 de los candidatos que tienen fondo horizontal, buscados
  // uno tras otro; mientras llega el primero queda el destacado de siempre
  const [heroes, setHeroes] = useState<Item[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  useEffect(() => {
    if (!active) return;
    setHeroes([]);
    setHeroIdx(0);
    let live = true;
    const found: Item[] = [];
    heroArtList(
      base.heroes || [],
      (it, a) => {
        if (found.length >= 6 || !(it.backdrop || a?.backdrop)) return;
        found.push(a ? withArt(it, a) : it);
        setHeroes(found.slice());
      },
      () => live && found.length < 6,
    );
    return () => {
      live = false;
    };
  }, [base.heroes, active]);
  const hero = heroes.length ? heroes[heroIdx % heroes.length] : firstHero;
  const [inRows, setInRows] = useState(false);
  // cambia de destacado cada 8 s solo con la portada a la vista (no recorriendo las filas)
  useEffect(() => {
    if (!active || inRows || heroes.length < 2) return;
    const id = setInterval(() => setHeroIdx(i => (i + 1) % heroes.length), 8000);
    return () => clearInterval(id);
  }, [active, inRows, heroes.length]);
  const [rowIdx, setRowIdx] = useState(0);
  const [info, setInfo] = useState<Info>({ item: hero });
  // el fondo del destacado puede llegar con el foco ya en las filas: ahí la portada sigue mostrando lo enfocado
  const inRowsRef = useRef(false);
  inRowsRef.current = inRows;
  useEffect(() => {
    if (!inRowsRef.current) setInfo({ item: hero });
  }, [hero]);
  const list = useRef<ScrollView>(null);
  // filas montadas (src/lib/rowwindow.ts): las de junto al foco al momento, las demás de a una en los momentos quietos
  const [win, setWin] = useState<Win>({ lo: 0, hi: 3 });
  const lastFocusAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const artTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // título enfocado (la respuesta del fondo solo se usa si sigue enfocado)
  const focused = useRef<Item | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (artTimer.current) clearTimeout(artTimer.current);
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

  // Al volver de la ficha (o del reproductor) el foco vuelve a la tarjeta que se abrió, en su fila (2.0.15). Antes la
  // pantalla se mostraba otra vez sin nada enfocado y el foco caía en el menú de arriba. Como ItemGrid (Buscar, Ver todo):
  // la fila se monta y se pone arriba, y la tarjeta se vuelve a montar con «preferred» un momento
  const lastCard = useRef<{ row: number; key: string } | null>(null);
  const [back, setBack] = useState<{ row: number; key: string; n: number } | null>(null);
  const [backPref, setBackPref] = useState(false);
  const [heroRev, setHeroRev] = useState(0);
  const wasActive = useRef(active);
  useEffect(() => {
    const came = active && !wasActive.current;
    wasActive.current = active;
    if (!came) return;
    const lc = lastCard.current;
    if (lc && inRowsRef.current && lc.row < rows.length) {
      setWin(w => onFocusWin(w, lc.row, rows.length));
      list.current?.scrollTo({ y: offsets[lc.row] || 0, animated: false });
      setBack(b => ({ row: lc.row, key: lc.key, n: (b?.n || 0) + 1 }));
    } else setHeroRev(r => r + 1);
    setBackPref(true);
    const id = setTimeout(() => setBackPref(false), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // foco en una tarjeta: su fila queda arriba y la portada muestra lo enfocado cuando el foco se detiene
  const onFocusAt = useCallback(
    (i: number, x: Item | Special) => {
      lastCard.current = { row: i, key: isItem(x) ? x.kind + x.id : x.kind + x.key };
      lastFocusAt.current = Date.now();
      setInRows(true);
      setRowIdx(i);
      setWin(w => onFocusWin(w, i, rows.length));
      // como el ejemplo de Amazon (vega-scrolling-sample): la lista no se desplaza sola (scrollEnabled false) y la app la
      // lleva a la fila enfocada con una animación nativa. Antes Vega desplazaba la lista por su cuenta al bajar y después
      // la app la movía otra vez (doble desplazamiento: el «jale» al bajar; al subir no pasaba)
      list.current?.scrollTo({ y: offsets[i] || 0, animated: true });
      if (timer.current) clearTimeout(timer.current);
      if (artTimer.current) clearTimeout(artTimer.current);
      focused.current = isItem(x) ? x : null;
      timer.current = setTimeout(() => {
        if (isItem(x)) {
          // como Roku: la portada cambia al título enfocado; sin fondo propio se busca (servidor y luego TMDB) tras una
          // pausa breve, y lo ya encontrado sale al instante
          const known = x.backdrop ? null : savedArt(x);
          setInfo({ item: known ? withArt(x, known) : x });
          if (!x.backdrop && !known && (x.kind === 'vod' || x.kind === 'series')) {
            artTimer.current = setTimeout(
              () =>
                heroArt(x, a => {
                  if (a && focused.current === x) setInfo({ item: withArt(x, a) });
                }),
              350,
            );
          }
        }
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
    lastFocusAt.current = Date.now();
    setInRows(false);
    setRowIdx(0);
    setWin(w => onFocusWin(w, 0, rows.length));
    setInfo({ item: hero });
    list.current?.scrollTo({ y: 0, animated: true });
  };

  // un momento quieto (250 ms sin mover el foco, también de lado): la fila siguiente de la ventana, de a una cada 120 ms
  useEffect(() => {
    if (!active) return;
    const next = idleStep(win, rowIdx, rows.length);
    if (!next) return;
    let id: ReturnType<typeof setTimeout>;
    const run = () => {
      const quiet = Date.now() - lastFocusAt.current;
      if (quiet < 250) {
        id = setTimeout(run, 250 - quiet);
        return;
      }
      setWin(w => (w === win ? next : w));
    };
    id = setTimeout(run, 120);
    return () => clearTimeout(id);
  }, [win, rowIdx, rows.length, active]);

  const selectItem = useCallback((it: Item) => openItem(nav, it), [nav]);
  const selectSpecial = useCallback((sp: Special) => openSpecial(nav, sp), [nav]);

  if (!ready) return <Spinner label={st.error || t('Cargando el catálogo…')} />;
  if (!rows.length) return <Message text={t('No hay contenido para mostrar.')} />;

  const fav = hero ? isFav(hero.kind, hero.id) : false;
  // arriba desde la primera fila vuelve a los botones; desde las demás, a la fila de arriba
  const btnsFocusable = !inRows || rowIdx === 0;

  return (
    <View style={s.root}>
      <Billboard info={inRows ? info : { item: hero }} compact={inRows} />
      {!inRows && heroes.length > 1 ? (
        <View style={s.dots} pointerEvents="none">
          {heroes.map((h, i) => (
            <View key={h.kind + h.id} style={[s.dot, i === heroIdx % heroes.length && s.dotOn]} />
          ))}
        </View>
      ) : null}
      {hero ? (
        <View style={[s.btns, inRows && s.btnsHidden]}>
          <Button
            key={'play' + heroRev}
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
        {/* todas las filas están (las lejanas solo con su título y su alto): la lista nunca arma una fila al apretar */}
        <ScrollView ref={list} scrollEnabled={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: px(600) }}>
          {rows.map((r, i) => (
            <RowView
              key={r.title + i}
              row={r}
              rowIndex={i}
              live={i >= win.lo && i <= win.hi}
              onItem={selectItem}
              onSpecial={selectSpecial}
              onFocusRow={onFocusAt}
              progressOf={progressOf}
              focusKey={back && back.row === i ? back.key : undefined}
              focusRev={back && back.row === i ? back.n : 0}
              focusPref={!!back && back.row === i && backPref}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    hero: { position: 'absolute', left: 0, top: 0, right: 0, height: px(1080) },
    heroImg: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
    dots: { position: 'absolute', right: SIDE, top: px(738), flexDirection: 'row' },
    dot: { width: px(14), height: px(14), borderRadius: px(7), marginLeft: px(10), backgroundColor: 'rgba(255,255,255,0.35)' },
    dotOn: { backgroundColor: '#fff', width: px(30) },
    heroDim: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.45 },
    // degradados como Roku (izquierda 1500×1080 al 92 %, abajo 1920×520 desde la fila 560) con el color de fondo del
    // tema (el del distribuidor o el original). Con ancho y alto fijos: Vega dibuja las imágenes del paquete a su tamaño
    // real (4 px) si solo se estiran con left/right/top/bottom, y la portada quedaba sin degradado
    heroGrad: { position: 'absolute', left: 0, top: px(560), width: px(1920), height: px(520) },
    heroShade: { position: 'absolute', left: 0, top: 0, width: px(1500), height: px(1080), opacity: 0.92 },
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
