// Ficha de película o serie: sinopsis, reparto, temporadas, episodios y "Más títulos como este".
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openItem, playEpisodes, playMovie } from '../actions';
import { CastMember, castFor } from '../api/tmdb';
import { SeriesInfo, seriesInfo, VodInfo, vodInfo } from '../api/xtream';
import { Button, Focusable } from '../components/ui';
import { RowView } from '../components/Tiles';
import { catalog, Item } from '../data/catalog';
import { digits } from '../lib/util';
import { useNav } from '../nav';
import { getState, isFav, progressMovie, progressSeries, toggleFav, useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';

export default function Detail({ item }: { item: Item }) {
  const nav = useNav();
  const st = useAppState();
  const [vod, setVod] = useState<VodInfo | null>(null);
  const [ser, setSer] = useState<SeriesInfo | null>(null);
  const [season, setSeason] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cast, setCast] = useState<CastMember[]>([]);

  useEffect(() => {
    const s = getState().session;
    if (!s) return;
    let alive = true;
    (item.kind === 'series' ? seriesInfo(s, item.id).then(r => alive && setSer(r)) : vodInfo(s, item.id).then(r => alive && setVod(r))).finally(
      () => alive && setLoading(false),
    );
    return () => {
      alive = false;
    };
  }, [item]);

  // temporada del último episodio visto
  const resumeEp = item.kind === 'series' ? progressSeries(item.id) : undefined;
  useEffect(() => {
    if (!ser || !resumeEp) return;
    const idx = ser.seasons.findIndex(x => x.episodes.some(e => e.id === digits(resumeEp.id)));
    if (idx >= 0) setSeason(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ser]);

  const info = item.kind === 'series' ? ser : vod;

  // reparto con foto (TMDB): al elegir a alguien se abre su filmografía en el servidor
  useEffect(() => {
    if (loading) return;
    let alive = true;
    setCast([]);
    castFor(item, info?.tmdb || '', info?.year || item.year).then(c => alive && setCast(c));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, loading]);
  const backdrop = info?.backdrop || item.backdrop || info?.poster || item.poster;
  const fav = isFav(item.kind, item.id);
  void st.rev;

  const similar = useMemo(() => {
    const list = catalog.grid('cat', item.cat, item.kind === 'series' ? 'series' : 'vod').filter(x => x.id !== item.id);
    return list.slice(0, 30);
  }, [item]);

  const movieProg = item.kind === 'vod' ? progressMovie(item.id) : undefined;
  const canResume = !!movieProg && movieProg.position > 5 && (movieProg.duration <= 0 || movieProg.position < movieProg.duration * 0.95);
  const eps = ser?.seasons[season]?.episodes || [];

  const playSeries = () => {
    if (!ser || !ser.seasons.length) return;
    if (resumeEp) {
      for (const sn of ser.seasons) {
        const i = sn.episodes.findIndex(e => e.id === digits(resumeEp.id));
        if (i >= 0) {
          playEpisodes(nav, item, sn.episodes, i, Math.floor(resumeEp.position));
          return;
        }
      }
    }
    playEpisodes(nav, item, ser.seasons[0].episodes, 0, 0);
  };

  const meta = [info?.year || item.year, (info?.rating || '') !== '' && Number(info?.rating) > 0 ? '★ ' + Number(info?.rating).toFixed(1) : item.rating > 0 ? '★ ' + item.rating.toFixed(1) : '', vod?.duration || '', ser ? ser.seasons.length + (ser.seasons.length === 1 ? ' temporada' : ' temporadas') : '']
    .filter(Boolean)
    .join('   ');

  return (
    <View style={s.root}>
      {backdrop ? <Image source={{ uri: backdrop }} style={s.bg} resizeMode="cover" /> : null}
      <View style={s.shade} />
      <ScrollView contentContainerStyle={{ paddingBottom: px(80) }}>
        <View style={s.head}>
          <Text style={s.title} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={s.meta}>{meta}</Text>
          {info?.genre ? <Text style={s.genre}>{info.genre}</Text> : null}
          <Text style={s.plot} numberOfLines={5}>
            {info?.plot || item.plot || (loading ? 'Cargando…' : '')}
          </Text>
          {info?.cast && !cast.length ? (
            <Text style={s.small} numberOfLines={2}>
              Reparto: {info.cast}
            </Text>
          ) : null}
          {info?.director ? <Text style={s.small}>Dirección: {info.director}</Text> : null}
          <View style={s.btns}>
            {item.kind === 'vod' ? (
              <>
                <Button label={canResume ? 'Continuar' : 'Reproducir'} icon="▶" primary preferred onPress={() => playMovie(nav, item, vod?.ext || item.ext)} />
                {canResume ? <Button label="Desde el inicio" icon="↺" onPress={() => playMovie(nav, item, vod?.ext || item.ext, true)} /> : null}
              </>
            ) : (
              <Button label={resumeEp ? 'Continuar' : 'Reproducir'} icon="▶" primary preferred onPress={playSeries} />
            )}
            <Button label={fav ? 'En mi lista' : 'Mi lista'} icon={fav ? '✓' : '+'} onPress={() => toggleFav(item.kind, item.id, item.name, item.poster, item.cat)} />
          </View>
        </View>

        {ser && ser.seasons.length ? (
          <View>
            <FlatList
              horizontal
              data={ser.seasons}
              keyExtractor={x => String(x.season)}
              contentContainerStyle={{ paddingHorizontal: SIDE }}
              style={{ marginTop: px(30) }}
              renderItem={({ item: sn, index }) => (
                <Focusable onFocus={() => setSeason(index)} onPress={() => setSeason(index)} style={f => [s.season, index === season && s.seasonOn, f && s.seasonF]}>
                  {f => <Text style={[s.seasonText, f && { color: '#000' }]}>Temporada {sn.season}</Text>}
                </Focusable>
              )}
            />
            <FlatList
              horizontal
              data={eps}
              keyExtractor={e => e.id}
              contentContainerStyle={{ paddingHorizontal: SIDE, paddingRight: px(200) }}
              style={{ marginTop: px(16) }}
              renderItem={({ item: e, index }) => {
                const p = st.progress.find(x => x.type === 'episode' && digits(x.id) === e.id);
                return (
                  <Focusable onPress={() => playEpisodes(nav, item, eps, index, p ? Math.floor(p.position) : 0)} style={f => [s.ep, f && s.epF]}>
                    <View style={s.epImgBox}>
                      {e.image || item.poster ? <Image source={{ uri: e.image || item.poster }} style={s.epImg} resizeMode="cover" /> : null}
                      {p && p.duration > 0 ? (
                        <View style={s.bar}>
                          <View style={[s.barFill, { width: `${Math.min(100, (p.position / p.duration) * 100)}%` }]} />
                        </View>
                      ) : null}
                    </View>
                    <Text style={s.epTitle} numberOfLines={1}>
                      {e.num}. {e.title || 'Episodio ' + e.num}
                    </Text>
                    {e.plot ? (
                      <Text style={s.epPlot} numberOfLines={2}>
                        {e.plot}
                      </Text>
                    ) : null}
                  </Focusable>
                );
              }}
            />
          </View>
        ) : null}

        {cast.length ? (
          <View style={{ marginTop: px(30) }}>
            <Text style={s.rowTitle}>Reparto</Text>
            <FlatList
              horizontal
              data={cast}
              keyExtractor={a => String(a.id)}
              contentContainerStyle={{ paddingHorizontal: SIDE, paddingRight: px(200) }}
              renderItem={({ item: a }) => (
                <Focusable onPress={() => nav.push({ name: 'actor', personId: a.id, actorName: a.name })} style={s.actor}>
                  {f => (
                    <>
                      <View style={[s.actorImgBox, f && s.actorImgF]}>
                        {a.photo ? <Image source={{ uri: a.photo }} style={s.actorImg} resizeMode="cover" /> : <Text style={s.actorInitial}>{a.name.slice(0, 1)}</Text>}
                      </View>
                      <Text style={[s.actorName, f && { color: '#fff' }]} numberOfLines={2}>
                        {a.name}
                      </Text>
                      {a.character ? (
                        <Text style={s.actorChar} numberOfLines={1}>
                          {a.character}
                        </Text>
                      ) : null}
                    </>
                  )}
                </Focusable>
              )}
            />
          </View>
        ) : null}

        {similar.length ? (
          <View style={{ marginTop: px(30) }}>
            <RowView row={{ title: 'Más títulos como este', type: 'poster', items: similar }} onItem={it => openItem(nav, it)} onSpecial={() => {}} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    bg: { position: 'absolute', left: 0, top: 0, right: 0, height: px(1080) },
    shade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,20,20,0.72)' },
    head: { paddingLeft: SIDE, paddingTop: px(110), width: px(1300) },
    title: { color: '#fff', fontSize: px(72), fontWeight: '900' },
    meta: { color: C.green, fontSize: px(28), fontWeight: '700', marginTop: px(12) },
    genre: { color: C.sub, fontSize: px(26), marginTop: px(8) },
    plot: { color: '#e5e5e5', fontSize: px(30), lineHeight: px(42), marginTop: px(18) },
    small: { color: C.sub, fontSize: px(24), marginTop: px(10) },
    btns: { flexDirection: 'row', marginTop: px(34) },
    season: { paddingHorizontal: px(26), height: px(56), borderRadius: px(28), justifyContent: 'center', marginRight: px(14), backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: px(3), borderColor: 'transparent' },
    seasonOn: { borderColor: C.red },
    seasonF: { backgroundColor: '#fff' },
    seasonText: { color: '#fff', fontSize: px(26), fontWeight: '700' },
    ep: { width: px(400), marginRight: px(22), borderWidth: px(4), borderColor: 'transparent', borderRadius: px(8), padding: px(4) },
    epF: { borderColor: '#fff', transform: [{ scale: 1.05 }] },
    epImgBox: { width: '100%', height: px(220), backgroundColor: C.card, borderRadius: px(6), overflow: 'hidden' },
    epImg: { width: '100%', height: '100%' },
    epTitle: { color: '#fff', fontSize: px(26), fontWeight: '700', marginTop: px(10) },
    epPlot: { color: C.sub, fontSize: px(22), marginTop: px(4) },
    bar: { position: 'absolute', left: 0, right: 0, bottom: 0, height: px(7), backgroundColor: 'rgba(255,255,255,0.35)' },
    barFill: { height: '100%', backgroundColor: C.red },
    rowTitle: { color: '#fff', fontSize: px(34), fontWeight: '800', marginLeft: SIDE, marginBottom: px(14) },
    actor: { width: px(170), marginRight: px(26), alignItems: 'center' },
    actorImgBox: { width: px(140), height: px(140), borderRadius: px(70), overflow: 'hidden', backgroundColor: C.card, borderWidth: px(4), borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    actorImgF: { borderColor: '#fff', transform: [{ scale: 1.08 }] },
    actorImg: { width: '100%', height: '100%' },
    actorInitial: { color: '#fff', fontSize: px(56), fontWeight: '800' },
    actorName: { color: '#e5e5e5', fontSize: px(22), fontWeight: '700', marginTop: px(10), textAlign: 'center' },
    actorChar: { color: C.dim, fontSize: px(20), marginTop: px(2), textAlign: 'center' },
  }),
);
