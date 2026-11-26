// Explorar (la lupa de la barra, solo con perfiles): como browse.php del web player en horizontal. «Explorar» y su
// subtítulo sobre el degradado del color, la cápsula Todo / Películas / Series, el orden (Agregados recientemente /
// A - Z / Mejor valorados), «Filtrar por título…» (abre el teclado de la app), el total, los géneros, las plataformas, el
// divisor y la cuadrícula de carátulas. Todo con el control: el orden cambia con cada OK y una plataforma elegida se
// quita con «Todas las plataformas».
import React, { useMemo, useState } from 'react';
import { Image, Platform as RNPlatform, ScrollView, StyleSheet, Text, View } from 'react-native';
import KeyboardModal from '../components/KeyboardModal';
import { Focusable, Message } from '../components/ui';
import { Shade } from '../components/Shade';
import { catalog, GENRES, label, PLATFORMS } from '../data/catalog';
import { features } from '../lib/tenant';
import { useAppState } from '../state';
import { t } from '../lib/i18n';
import { alpha, C, px, SIDE, themed } from '../theme';
import { ItemGrid } from './Grid';

type Type = 'all' | 'vod' | 'series';
type Sort = 'recent' | 'az' | 'rating';
const SORTS: Sort[] = ['recent', 'az', 'rating'];

export default function Explore({ active }: { active: boolean }) {
  const st = useAppState();
  const [type, setType] = useState<Type>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [genre, setGenre] = useState('');
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  // el foco: al abrir la lupa entra a «Filtrar por título…» (como la web y la computadora) y vuelve ahí al cerrar el
  // teclado sin escribir; con algo escrito baja a la primera carátula. De vuelta de una ficha, ItemGrid lo devuelve a la
  // carátula que se abrió.
  const [filterRev, setFilterRev] = useState(0);
  const [focusRev, setFocusRev] = useState(0);
  const withPlatforms = features().platforms;
  const plat = withPlatforms ? PLATFORMS.find(p => p.key === platform) : undefined;
  const gen = GENRES.find(g => g.key === genre);
  const tags = useMemo(() => catalog.exploreTags(type, withPlatforms), [type, withPlatforms, st.catalogRev]);
  const res = useMemo(() => catalog.explore(type, sort, plat?.key || '', genre, q), [type, sort, plat, genre, q, st.catalogRev]);

  const title = plat ? label(plat) : gen ? label(gen) : t('Explorar');
  const sub = plat
    ? t('Todo el contenido de {x}, filtra por género o tipo', { x: label(plat) })
    : gen
      ? t('Películas y series de {x}', { x: label(gen).toLowerCase() })
      : t('Todo el catálogo de películas y series');
  const accent = plat?.color || '#E50914';
  const sortLabel = sort === 'az' ? 'A - Z' : t(sort === 'rating' ? 'Mejor valorados' : 'Agregados recientemente');

  const header = (
    <View>
      <View style={s.head}>
        {RNPlatform.OS === 'web' ? (
          <View pointerEvents="none" style={[s.glow, { backgroundImage: `radial-gradient(${px(1800)}px ${px(450)}px at 0% 0%, ${alpha(accent, 0.33)}, transparent 70%)` } as any]} />
        ) : (
          <View pointerEvents="none" style={s.glow}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(accent, 0.3) }]} />
            <Shade side="bottom" style={StyleSheet.absoluteFill as any} />
            <Shade side="left" style={[StyleSheet.absoluteFill as any, { transform: [{ scaleX: -1 }] }]} />
          </View>
        )}
        <View style={s.titleRow}>
          {plat?.image ? <Image source={plat.image} style={s.platImg} resizeMode="contain" /> : null}
          <Text style={s.title} numberOfLines={1}>{title}</Text>
        </View>
        <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={s.bar}>
        <View style={s.row1}>
          <View style={s.seg}>
            {(['all', 'vod', 'series'] as Type[]).map(k => (
              <Focusable key={k} onPress={() => setType(k)} style={f => [s.segBtn, type === k && s.segOn, f && s.focus]}>
                {f => <Text style={[s.segText, type === k && s.segTextOn, f && s.focusText]}>{t(k === 'all' ? 'Todo' : k === 'vod' ? 'Películas' : 'Series')}</Text>}
              </Focusable>
            ))}
          </View>
          <Focusable onPress={() => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length])} style={f => [s.select, f && s.focus]}>
            {f => <Text style={[s.selectText, f && s.focusText]}>{sortLabel}  ▾</Text>}
          </Focusable>
          <Focusable key={'filter:' + filterRev} preferred onPress={() => setTyping(true)} style={f => [s.input, f && s.inputF]}>
            <Text style={[s.inputText, !q && s.ph]} numberOfLines={1}>{q || t('Filtrar por título…')}</Text>
          </Focusable>
          <Text style={s.count}>{res.total ? t('{n} títulos', { n: res.total.toLocaleString() }) : ''}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <Chip text={t('Todos los géneros')} on={!gen} onPress={() => setGenre('')} />
          {tags.genres.map(g => (
            <Chip key={g.key} text={label(g)} on={genre === g.key} onPress={() => setGenre(g.key)} />
          ))}
        </ScrollView>
        {tags.platforms.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[s.chips, s.chips2]}>
            {plat ? <Chip text={t('Todas las plataformas')} on={false} onPress={() => setPlatform('')} /> : null}
            {tags.platforms.map(p => (
              <Chip key={p.key} text={label(p)} on={plat?.key === p.key} onPress={() => setPlatform(plat?.key === p.key ? '' : p.key)} />
            ))}
          </ScrollView>
        ) : null}
      </View>
      {!res.items.length ? <Message text={t('No hay títulos con estos filtros.')} /> : null}
    </View>
  );

  return (
    <View style={s.root}>
      <ItemGrid items={res.items} header={header} active={active} focusFirst={typing ? 0 : focusRev} />
      {typing ? (
        <KeyboardModal
          title={t('Filtrar por título…')}
          value={q}
          onChange={setQ}
          onClose={() => (setTyping(false), setFilterRev(n => n + 1))}
          onDone={v => {
            setQ(v);
            setTyping(false);
            if (v.trim()) setFocusRev(n => n + 1);
            else setFilterRev(n => n + 1);
          }}
        />
      ) : null}
    </View>
  );
}

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} style={f => [s.chip, on && s.chipOn, f && s.focus]}>
      {f => <Text style={[s.chipText, on && s.chipTextOn, f && s.focusText]}>{text}</Text>}
    </Focusable>
  );
}

// medidas del web player (browse.php) un poco más grandes para verse de lejos en la TV
const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    head: { paddingTop: px(150), paddingBottom: px(10), marginHorizontal: -SIDE, paddingHorizontal: SIDE },
    glow: { position: 'absolute', left: 0, top: 0, width: px(1920), height: px(450) },
    titleRow: { flexDirection: 'row', alignItems: 'center' },
    platImg: { width: px(110), height: px(84), marginRight: px(22), borderRadius: px(8) },
    title: { color: '#fff', fontSize: px(66), fontWeight: '800' },
    sub: { color: C.sub, fontSize: px(26), marginTop: px(4) },
    bar: { borderBottomWidth: px(2), borderBottomColor: '#222', marginHorizontal: -SIDE, paddingHorizontal: SIDE, paddingBottom: px(8), marginBottom: px(28) },
    row1: { flexDirection: 'row', alignItems: 'center', paddingTop: px(16) },
    seg: { flexDirection: 'row', borderWidth: px(2), borderColor: '#444', borderRadius: px(40), overflow: 'hidden', marginRight: px(18) },
    segBtn: { paddingHorizontal: px(26), height: px(58), justifyContent: 'center' },
    segOn: { backgroundColor: '#fff' },
    segText: { color: '#ddd', fontSize: px(24) },
    segTextOn: { color: '#000', fontWeight: '700' },
    select: { height: px(58), justifyContent: 'center', paddingHorizontal: px(20), borderWidth: px(2), borderColor: '#555', borderRadius: px(6), backgroundColor: '#000', marginRight: px(18) },
    selectText: { color: '#fff', fontSize: px(24) },
    input: { width: px(380), height: px(58), justifyContent: 'center', paddingHorizontal: px(20), borderWidth: px(2), borderColor: '#555', borderRadius: px(6), backgroundColor: '#000' },
    inputF: { borderColor: C.focus, backgroundColor: alpha(C.text, 0.12) },
    inputText: { color: '#fff', fontSize: px(24) },
    ph: { color: C.dim },
    count: { flex: 1, textAlign: 'right', color: C.sub, fontSize: px(22) },
    chips: { paddingTop: px(22), paddingBottom: px(8), alignItems: 'center' },
    chips2: { paddingTop: px(4) },
    chip: { height: px(56), paddingHorizontal: px(26), borderRadius: px(28), justifyContent: 'center', marginRight: px(16), borderWidth: px(2), borderColor: alpha('#ffffff', 0.35), backgroundColor: alpha('#141414', 0.6) },
    chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
    chipText: { color: '#fff', fontSize: px(24) },
    chipTextOn: { color: '#000', fontWeight: '700' },
    focus: { backgroundColor: C.focus, borderColor: C.red, transform: [{ scale: 1.08 }] },
    focusText: { color: C.onFocus },
  }),
);
