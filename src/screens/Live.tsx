// TV en vivo: categorías, canales y guía (EPG) del canal enfocado.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { channelEpg, EpgEntry } from '../api/xtream';
import PinDialog from '../components/PinDialog';
import { Button, Focusable, Message, Spinner } from '../components/ui';
import { catalog, Item } from '../data/catalog';
import { clock, digits, nowSec } from '../lib/util';
import { useNav } from '../nav';
import { getState, isFav, toggleFav, useAppState } from '../state';
import { alpha, C, px, themed } from '../theme';

export default function Live() {
  const nav = useNav();
  const st = useAppState();
  const [cat, setCat] = useState('all');
  const [pinFor, setPinFor] = useState('');
  const [focused, setFocused] = useState<Item | null>(null);
  const [epg, setEpg] = useState<EpgEntry[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedId = useRef('');

  const cats = useMemo(() => (st.loaded.live ? catalog.liveCats() : []), [st.loaded.live, st.catalogRev, pinFor]);
  const favIds = st.favorites.filter(f => f.type === 'live').map(f => digits(f.id));
  const channels = useMemo(() => (st.loaded.live ? catalog.liveChannels(cat, favIds) : []), [st.loaded.live, st.catalogRev, cat, cat === 'fav' ? favIds.join(',') : '']);

  // guía del canal enfocado (espera un momento para no pedirla en cada paso)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setEpg([]);
    if (!focused) return;
    const ch = focused;
    focusedId.current = ch.id;
    timer.current = setTimeout(() => {
      const s = getState().session;
      if (s) channelEpg(s, { id: ch.id, epg: ch.epg, name: ch.name }).then(list => focusedId.current === ch.id && setEpg(list));
    }, 600);
  }, [focused]);

  if (!st.loaded.live) return <Spinner label="Cargando los canales…" />;

  const now = nowSec();
  const cur = epg.find(e => e.s <= now && now < e.e);

  return (
    <View style={s.root}>
      <FlatList
        style={s.cats}
        data={cats}
        keyExtractor={c => c.id}
        renderItem={({ item: c }) => (
          <Focusable
            onPress={() => (c.locked ? setPinFor(c.id) : setCat(c.id))}
            onFocus={() => !c.locked && setCat(c.id)}
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
            data={channels}
            keyExtractor={c => c.id}
            initialNumToRender={12}
            getItemLayout={(_, i) => ({ length: px(96), offset: px(96) * i, index: i })}
            renderItem={({ item: c, index }) => (
              <Focusable onPress={() => openItem(nav, c, channels)} onFocus={() => setFocused(c)} style={f => [s.ch, f && s.chF]}>
                {f => (
                  <>
                    <Text style={[s.chNum, f && { color: C.onFocus }]}>{c.num || index + 1}</Text>
                    <View style={s.logoBox}>{c.poster ? <Image source={{ uri: c.poster }} style={s.logo} resizeMode="contain" /> : null}</View>
                    <Text style={[s.chName, f && { color: C.onFocus }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {isFav('live', c.id) ? <Text style={s.star}>★</Text> : null}
                  </>
                )}
              </Focusable>
            )}
          />
        ) : (
          <Message text={cat === 'fav' ? 'Aún no tienes canales favoritos. Abre un canal y pulsa ★ en el reproductor.' : 'No hay canales en esta categoría.'} />
        )}
      </View>
      <View style={s.guide}>
        {focused ? (
          <>
            <View style={s.guideLogo}>{focused.poster ? <Image source={{ uri: focused.poster }} style={s.logo} resizeMode="contain" /> : null}</View>
            <Text style={s.guideName}>{focused.name}</Text>
            {cur ? (
              <>
                <Text style={s.live}>AHORA · {clock(cur.s)} - {clock(cur.e)}</Text>
                <Text style={s.prog}>{cur.t}</Text>
                <View style={s.bar}>
                  <View style={[s.barFill, { width: `${Math.min(100, ((now - cur.s) / Math.max(1, cur.e - cur.s)) * 100)}%` }]} />
                </View>
                {cur.d ? (
                  <Text style={s.desc} numberOfLines={5}>
                    {cur.d}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={s.desc}>Sin información de la guía.</Text>
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
                label={isFav('live', focused.id) ? '★ Quitar de favoritos' : '☆ Agregar a favoritos'}
                last
                onPress={() => toggleFav('live', focused.id, focused.name, focused.poster, focused.cat)}
              />
            </View>
          </>
        ) : (
          <Text style={s.desc}>Elige un canal para ver la guía.</Text>
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
    logoBox: { width: px(110), height: px(64), marginRight: px(18), justifyContent: 'center' },
    logo: { width: '100%', height: '100%' },
    chName: { color: C.text, fontSize: px(28), flex: 1 },
    star: { color: '#f5c518', fontSize: px(28), marginLeft: px(10) },
    guide: { flex: 1, marginLeft: px(30), marginRight: px(60), backgroundColor: C.bg2, borderRadius: px(10), padding: px(30), marginBottom: px(40) },
    guideLogo: { width: px(200), height: px(110), marginBottom: px(14) },
    guideName: { color: C.text, fontSize: px(36), fontWeight: '800' },
    live: { color: C.red, fontSize: px(24), fontWeight: '800', marginTop: px(16) },
    prog: { color: C.text, fontSize: px(30), fontWeight: '700', marginTop: px(6) },
    bar: { height: px(6), backgroundColor: alpha(C.text, 0.25), marginTop: px(12), borderRadius: px(3) },
    barFill: { height: '100%', backgroundColor: C.red, borderRadius: px(3) },
    desc: { color: C.sub, fontSize: px(24), marginTop: px(14), lineHeight: px(34) },
    next: { color: C.sub, fontSize: px(24), marginTop: px(10) },
    favBtn: { marginTop: px(24), flexDirection: 'row' },
  }),
);
