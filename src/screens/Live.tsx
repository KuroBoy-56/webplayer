// TV en vivo: categorías, canales y la miniatura con la guía (EPG). Pasar por los canales y las carpetas no cambia nada
// (sin conexiones ni redibujos a cada paso): OK en una carpeta muestra sus canales; OK en un canal lo pone en la
// miniatura (punto rojo) y OK otra vez en ese canal lo abre en pantalla grande. Al cerrar el canal el foco vuelve a él.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { channelEpg, EpgEntry } from '../api/xtream';
import PinDialog from '../components/PinDialog';
import LivePreview, { stopLivePreview } from '../components/LivePreview';
import { ScrollingText } from '../components/ScrollingText';
import { takeLastLive } from '../player/preview-session';
import { Button, Focusable, Message, Spinner } from '../components/ui';
import { catalog, Item } from '../data/catalog';
import { clock, digits, nowSec } from '../lib/util';
import { useNav } from '../nav';
import { getState, isFav, toggleFav, useAppSelector } from '../state';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';

const ChannelRow = memo(function ChannelRow({ channel: c, index, favorite, live, preferred, open, focus }: {
  channel: Item; index: number; favorite: boolean; live: boolean; preferred: boolean; open: (channel: Item) => void; focus: (id: string) => void;
}) {
  return (
    <Focusable preferred={preferred} onPress={() => open(c)} onFocus={() => focus(c.id)} style={f => [s.ch, f && s.chF]}>
      {f => <>
        {/* el canal que está en la miniatura */}
        <View style={[s.dot, !live && s.dotOff]} />
        <Text style={[s.chNum, f && { color: C.onFocus }]}>{c.num || index + 1}</Text>
        <View style={s.logoBox}>{c.poster ? <Image source={{ uri: c.poster }} style={s.logo} resizeMode="contain" /> : null}</View>
        <Text style={[s.chName, f && { color: C.onFocus }]} numberOfLines={1}>{c.name}</Text>
        {favorite ? <Text style={s.star}>★</Text> : null}
      </>}
    </Focusable>
  );
});

// active: la pantalla está a la vista (con el reproductor encima, la vista previa se apaga)
export default function Live({ active = true }: { active?: boolean }) {
  const nav = useNav();
  const loaded = useAppSelector(st => st.loaded.live);
  const catalogRev = useAppSelector(st => st.catalogRev);
  const favorites = useAppSelector(st => st.favorites);
  const [cat, setCat] = useState('all');
  const [pinFor, setPinFor] = useState('');
  // el canal de la miniatura (punto rojo): solo cambia con OK; sigue al cambiar de carpeta
  const [focused, setFocused] = useState<Item | null>(null);
  const [epg, setEpg] = useState<EpgEntry[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // el último canal con el foco: al cerrar el canal en pantalla grande el foco vuelve a él (se vuelve a montar con
  // «preferred», como Deportes); sin esto caía en el menú de arriba
  const lastId = useRef('');
  const [target, setTarget] = useState({ id: '', n: 0 });
  // «preferred» solo un momento: si la fila se volviera a montar al desplazarse no debe robar el foco
  const [pref, setPref] = useState('');
  const prefRef = useRef('');
  prefRef.current = pref;
  const focusId = useCallback((id: string) => {
    lastId.current = id;
    // ya llegó el foco al canal: «preferred» se apaga (si no, al desplazarse la fila volvería a robar el foco)
    if (id === prefRef.current) setPref('');
  }, []);
  useEffect(() => {
    if (!active) return;
    // el canal que quedó sonando en pantalla grande (con ▲▼ se pudo cambiar): ahí el foco, el punto rojo y la miniatura
    const played = takeLastLive();
    const ch = played ? chRef.current.find(c => c.id === played) : undefined;
    if (ch) {
      lastId.current = ch.id;
      setFocused(ch);
    }
    if (!lastId.current) return;
    // si el canal quedó lejos (cambiado con ▲▼), la lista va hasta él para que su fila exista y reciba el foco
    const at = chRef.current.findIndex(c => c.id === lastId.current);
    const want = lastId.current;
    const go = () => {
      if (at < 0 || prefRef.current !== want) return;
      try {
        listRef.current?.scrollToIndex({ index: at, viewPosition: 0.4, animated: false });
      } catch {
        // lista todavía sin medir
      }
    };
    setTarget(x => ({ id: want, n: x.n + 1 }));
    setPref(want);
    prefRef.current = want;
    go();
    // la lista dibuja las filas lejanas un momento después (y en la tele algo pudo tomar el foco y desplazarla): se
    // vuelve a ir al canal hasta que su fila tenga el foco
    const ids = [150, 450, 900].map(ms => setTimeout(go, ms));
    const id = setTimeout(() => setPref(''), 3000);
    return () => {
      ids.forEach(clearTimeout);
      clearTimeout(id);
    };
  }, [active]);

  const cats = useMemo(() => (loaded ? catalog.liveCats() : []), [loaded, catalogRev, pinFor]);
  const favIds = useMemo(() => favorites.filter(f => f.type === 'live').map(f => digits(f.id)), [favorites]);
  const channels = useMemo(() => (loaded ? catalog.liveChannels(cat, favIds) : []), [loaded, catalogRev, cat, cat === 'fav' ? favIds.join(',') : '']);
  const listRef = useRef<FlatList<Item>>(null);
  const chRef = useRef(channels);
  chRef.current = channels;

  // guía del canal enfocado (espera un momento para no pedirla en cada paso)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!active) return;
    setEpg(previous => previous.length ? [] : previous);
    if (!focused) return;
    const ch = focused;
    let alive = true;
    timer.current = setTimeout(() => {
      const s = getState().session;
      if (s) channelEpg(s, { id: ch.id, epg: ch.epg, name: ch.name }).then(list => alive && setEpg(list)).catch(() => {});
    }, 150);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [focused, active]);

  // favoritos en un Set y la fila memorizada: enfocar un canal no vuelve a dibujar toda la lista
  const favSet = useMemo(() => new Set(favIds), [favIds]);
  const liveId = focused?.id || '';
  const liveRef = useRef('');
  liveRef.current = liveId;
  // OK: a la miniatura; OK otra vez en el mismo canal: pantalla grande (por referencia: elegir otro canal solo vuelve
  // a dibujar las dos filas del punto rojo)
  const openChannel = useCallback((channel: Item) => {
    lastId.current = channel.id;
    if (channel.id !== liveRef.current) {
      setFocused(channel);
      return;
    }
    void stopLivePreview();
    openItem(nav, channel, channels);
  }, [nav, channels]);
  const renderCh = useCallback(
    ({ item, index }: { item: Item; index: number }) => (
      <ChannelRow channel={item} index={index} favorite={favSet.has(item.id)} live={item.id === liveId} preferred={item.id === pref} open={openChannel} focus={focusId} />
    ),
    [openChannel, favSet, liveId, pref, focusId],
  );

  if (!loaded) return <Spinner label={t('Cargando los canales…')} />;

  const now = nowSec();
  const cur = epg.find(e => e.s <= now && now < e.e);

  return (
    <View style={s.root}>
      <FlatList
        style={s.cats}
        data={cats}
        initialNumToRender={12}
        windowSize={5}
        maxToRenderPerBatch={8}
        keyExtractor={c => c.id}
        renderItem={({ item: c }) => (
          <Focusable
            onPress={() => (c.locked ? setPinFor(c.id) : setCat(c.id))}
            style={f => [s.cat, c.id === cat && s.catOn, f && s.catF]}>
            {f => (
              <>
                <Text style={[s.catText, f && { color: C.onFocus }]} numberOfLines={1}>
                  {c.locked ? '🔒 ' : ''}
                  {c.name}
                </Text>
                {c.id !== 'fav' ? <Text style={[s.catCount, f && { color: C.onFocus }]}>{c.count}</Text> : null}
              </>
            )}
          </Focusable>
        )}
      />
      <View style={s.list}>
        {channels.length ? (
          <FlatList
            ref={listRef}
            // otra carpeta: la lista empieza arriba
            key={cat}
            data={channels}
            // el canal al que vuelve el foco se monta otra vez con «preferred» (así el foco llega a él)
            keyExtractor={c => (c.id === target.id ? c.id + ':' + target.n : c.id)}
            extraData={liveId + '|' + pref}
            initialNumToRender={12}
            windowSize={5}
            maxToRenderPerBatch={8}
            getItemLayout={(_, i) => ({ length: px(96), offset: px(96) * i, index: i })}
            renderItem={renderCh}
          />
        ) : (
          <Message text={cat === 'fav' ? t('Aún no tienes canales favoritos. Abre un canal y pulsa ★ en el reproductor.') : t('No hay canales en esta categoría.')} />
        )}
      </View>
      <View style={s.guide}>
        {focused ? (
          <>
            {/* miniatura del canal elegido con OK (empieza enseguida) */}
            <LivePreview channel={focused} active={active} delay={150} />
            <Text style={s.guideName}>{focused.name}</Text>
            {cur ? (
              <>
                <Text style={s.live}>{t('AHORA')} · {clock(cur.s)} - {clock(cur.e)}</Text>
                <Text style={s.prog}>{cur.t}</Text>
                <View style={s.bar}>
                  <View style={[s.barFill, { width: `${Math.min(100, ((now - cur.s) / Math.max(1, cur.e - cur.s)) * 100)}%` }]} />
                </View>
                {/* la descripción larga sube sola dentro de su lugar: nunca tapa lo que sigue ni «Agregar a favoritos» */}
                {cur.d ? <ScrollingText text={cur.d} style={s.descText} box={s.descBox} line={px(34)} /> : null}
              </>
            ) : (
              <Text style={s.desc}>{t('Sin información de la guía.')}</Text>
            )}
            {epg
              .filter(e => e.s > now)
              .slice(0, 4)
              .map(e => (
                <Text key={e.s} style={s.next} numberOfLines={1}>
                  {clock(e.s)}  {e.t}
                </Text>
              ))}
            <View style={s.favBtn}>
              <Button
                label={isFav('live', focused.id) ? '★ ' + t('Quitar de favoritos') : '☆ ' + t('Agregar a favoritos')}
                last
                onPress={() => toggleFav('live', focused.id, focused.name, focused.poster, focused.cat)}
              />
            </View>
          </>
        ) : (
          <Text style={s.desc}>{t('Pulsa OK en un canal para verlo aquí; OK otra vez lo abre en pantalla grande.')}</Text>
        )}
      </View>
      <PinDialog
        visible={!!pinFor}
        onClose={() => setPinFor('')}
        onOk={() => {
          setCat(pinFor);
          setPinFor('');
        }}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, flexDirection: 'row', paddingTop: px(130), paddingLeft: px(60) },
    cats: { width: px(440), flexGrow: 0 },
    cat: { height: px(70), flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(22), borderRadius: px(6), marginBottom: px(6) },
    catOn: { backgroundColor: alpha(C.red, 0.35) },
    catF: { backgroundColor: C.focus },
    catText: { color: C.text, fontSize: px(26), flex: 1 },
    catCount: { color: C.dim, fontSize: px(22), marginLeft: px(10) },
    list: { width: px(760), marginLeft: px(24) },
    ch: { height: px(88), flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(18), borderRadius: px(6), marginBottom: px(8), backgroundColor: alpha(C.text, 0.05) },
    chF: { backgroundColor: C.focus, transform: [{ scale: 1.03 }] },
    chNum: { color: C.dim, fontSize: px(24), width: px(70) },
    dot: { width: px(14), height: px(14), borderRadius: px(7), backgroundColor: C.red, marginRight: px(12) },
    dotOff: { backgroundColor: 'transparent' },
    logoBox: { width: px(110), height: px(64), marginRight: px(18), justifyContent: 'center' },
    logo: { width: '100%', height: '100%' },
    chName: { color: C.text, fontSize: px(28), flex: 1 },
    star: { color: '#f5c518', fontSize: px(28), marginLeft: px(10) },
    guide: { flex: 1, marginLeft: px(30), marginRight: px(60), backgroundColor: C.bg2, borderRadius: px(10), padding: px(30), marginBottom: px(40), overflow: 'hidden' },
    guideLogo: { width: px(200), height: px(110), marginBottom: px(14) },
    // los textos de la guía no se encogen (en la tele se encogían y la descripción quedaba encima de lo demás)
    guideName: { color: C.text, fontSize: px(36), fontWeight: '800', flexShrink: 0 },
    live: { color: C.red, fontSize: px(24), fontWeight: '800', marginTop: px(16), flexShrink: 0 },
    prog: { color: C.text, fontSize: px(30), fontWeight: '700', marginTop: px(6), flexShrink: 0 },
    bar: { height: px(6), backgroundColor: alpha(C.text, 0.25), marginTop: px(12), borderRadius: px(3) },
    barFill: { height: '100%', backgroundColor: C.red, borderRadius: px(3) },
    desc: { color: C.sub, fontSize: px(24), marginTop: px(14), lineHeight: px(34), flexShrink: 0 },
    descBox: { marginTop: px(14) },
    descText: { color: C.sub, fontSize: px(24), lineHeight: px(34) },
    next: { color: C.sub, fontSize: px(24), marginTop: px(10), flexShrink: 0 },
    favBtn: { marginTop: px(24), flexDirection: 'row', flexShrink: 0 },
  }),
);
