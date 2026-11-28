// Tarjeta de «En vivo ahora» (Inicio, con perfiles): la cancha del deporte de fondo, los escudos, el marcador, el minuto
// (o la hora si empieza en unos minutos) y el canal donde verlo. Y el fondo grande de la portada al enfocarla.
import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { fieldColor, liveClock, LiveCard } from '../data/liveTv';
import { t } from '../lib/i18n';
import { C, px, themed } from '../theme';
import { Focusable } from './ui';

export const LIVE_W = () => px(440);
export const LIVE_H = () => px(248);

function Badge({ uri, name, size }: { uri: string; name: string; size: number }) {
  return uri ? (
    <Image source={{ uri: uri + '/small' }} style={{ width: size, height: size }} resizeMode="contain" />
  ) : (
    <View style={[s.noBadge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.noBadgeText, { fontSize: size * 0.38 }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** líneas de la cancha (centro y círculo), dibujadas con bordes: sirven para casi todos los deportes */
function FieldLines({ w, h }: { w: number; h: number }) {
  const r = h * 0.32;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[s.line, { left: w / 2 - 1, top: 0, width: 2, height: h }]} />
      <View style={[s.circle, { left: w / 2 - r, top: h / 2 - r, width: r * 2, height: r * 2, borderRadius: r }]} />
      <View style={[s.box, { left: -2, top: h * 0.25, width: w * 0.12, height: h * 0.5 }]} />
      <View style={[s.box, { right: -2, top: h * 0.25, width: w * 0.12, height: h * 0.5 }]} />
    </View>
  );
}

export const LiveTile = memo(function LiveTile({ c, onPress, onFocus }: { c: LiveCard; onPress: () => void; onFocus?: () => void }) {
  const w = LIVE_W();
  const h = LIVE_H();
  const score = c.soon || !(c.hs || c.as) ? 'vs' : c.hs + ' - ' + c.as;
  if (c.solo) return <SoloTile c={c} w={w} h={h} onPress={onPress} onFocus={onFocus} />;
  return (
    <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.tile, { width: w, height: h, backgroundColor: fieldColor(c.sp) }, f && s.tileF]}>
      <FieldLines w={w} h={h} />
      <View style={s.shade} />
      <View style={s.top}>
        <Text style={s.league} numberOfLines={1}>{c.lg}</Text>
        <View style={[s.pill, c.soon && s.pillSoon]}>
          <Text style={s.pillText} numberOfLines={1}>{c.soon ? t('Empieza') + ' ' + liveClock(c, '') : t('EN VIVO') + '  ' + liveClock(c, t('Descanso'))}</Text>
        </View>
      </View>
      <View style={s.mid}>
        <View style={s.team}>
          <Badge uri={c.hb} name={c.h} size={px(78)} />
          <Text style={s.teamName} numberOfLines={1}>{c.h}</Text>
        </View>
        <Text style={[s.score, score.length > 5 && s.scoreLong]} numberOfLines={1}>{score}</Text>
        <View style={s.team}>
          <Badge uri={c.ab} name={c.a} size={px(78)} />
          <Text style={s.teamName} numberOfLines={1}>{c.a}</Text>
        </View>
      </View>
      <Text style={s.chan} numberOfLines={1}>📺 {c.best.name}</Text>
    </Focusable>
  );
});

/**
 * un evento sin dos equipos (pelea, boxeo, WWE, carrera): la disciplina y el nombre del evento, con su póster en
 * pequeño si lo tiene; sin escudos ni marcador (al enfocarla el póster va en grande de fondo, LiveBackdrop)
 */
function SoloTile({ c, w, h, onPress, onFocus }: { c: LiveCard; w: number; h: number; onPress: () => void; onFocus?: () => void }) {
  return (
    <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.tile, { width: w, height: h, backgroundColor: fieldColor(c.sp) }, f && s.tileF]}>
      <View style={s.shade} />
      <View style={s.top}>
        <Text style={s.league} numberOfLines={1}>{c.lg}</Text>
        <View style={[s.pill, c.soon && s.pillSoon]}>
          <Text style={s.pillText} numberOfLines={1}>{c.soon ? t('Empieza') + ' ' + liveClock(c, '') : t('EN VIVO') + '  ' + liveClock(c, t('Descanso'))}</Text>
        </View>
      </View>
      <View style={s.soloMid}>
        {c.th ? <Image source={{ uri: c.th }} style={s.soloPoster} resizeMode="cover" /> : null}
        <View style={[s.soloText, !c.th && s.soloTextCenter]}>
          <Text style={[s.soloSport, !c.th && s.center]} numberOfLines={1}>{c.spl}</Text>
          <Text style={[s.soloEv, !c.th && s.center]} numberOfLines={3}>{c.ev}</Text>
        </View>
      </View>
      <Text style={s.chan} numberOfLines={1}>📺 {c.best.name}</Text>
    </Focusable>
  );
}

const STADIUM = require('../../assets/image/sports_bg.jpg');

/** al final de la fila: toda la agenda en Deportes (el estadio con el color de la app) */
export const GoSportsTile = memo(function GoSportsTile({ onPress, onFocus }: { onPress: () => void; onFocus?: () => void }) {
  return (
    <Focusable onPress={onPress} onFocus={onFocus} style={f => [s.tile, { width: px(300), height: LIVE_H() }, f && s.tileF]}>
      {/* el estadio de Deportes en miniatura, translúcido; el texto se lee encima */}
      <Image source={STADIUM} style={[StyleSheet.absoluteFill, { opacity: 0.5 }]} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.3)' }]} />
      <View style={s.goBody}>
        <Text style={s.goIcon}>🏟️</Text>
        <Text style={s.goTitle} numberOfLines={2}>{t('Ir a Deportes')}</Text>
        <Text style={s.goSub} numberOfLines={2}>{t('Toda la agenda de hoy y mañana')}</Text>
      </View>
    </Focusable>
  );
});

/**
 * el fondo grande de la portada con el foco en un partido: la imagen del evento (TheSportsDB) o el estadio sin personas
 * con los dos escudos grandes (nunca en negro ni con el último póster de una película)
 */
export function LiveBackdrop({ c }: { c: LiveCard }) {
  if (c.th) return <Image source={{ uri: c.th }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  // sin equipos (pelea, carrera): el estadio solo, sin escudos ni «VS»
  if (c.solo) {
    return (
      <View style={StyleSheet.absoluteFill}>
        <Image source={STADIUM} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image source={STADIUM} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <View style={s.bigTeams}>
        <Badge uri={c.hb} name={c.h} size={px(300)} />
        <Text style={s.bigVs}>VS</Text>
        <Badge uri={c.ab} name={c.a} size={px(300)} />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    tile: { borderRadius: px(12), marginRight: px(20), overflow: 'hidden', borderWidth: px(4), borderColor: 'transparent', marginTop: px(12) },
    tileF: { borderColor: C.focus, transform: [{ scale: 1.06 }], zIndex: 10 },
    line: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.22)' },
    circle: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,255,255,0.22)' },
    box: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(255,255,255,0.18)' },
    shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(16), paddingTop: px(12) },
    league: { flex: 1, color: '#fff', fontSize: px(22), fontWeight: '700', opacity: 0.9 },
    // se ajusta a su texto («EN VIVO  Descanso», «EN VIVO  Alargue · 105'») en una línea y como mucho el 62 % del ancho
    pill: { backgroundColor: '#e50914', borderRadius: px(6), paddingHorizontal: px(10), paddingVertical: px(3), marginLeft: px(10), maxWidth: '62%', flexShrink: 0 },
    pillSoon: { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
    pillText: { color: '#fff', fontSize: px(20), fontWeight: '800' },
    mid: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: px(18) },
    // los equipos se reparten el ancho que deja el marcador (que nunca se corta ni baja de línea)
    team: { flex: 1, minWidth: 0, alignItems: 'center' },
    teamName: { color: '#fff', fontSize: px(20), fontWeight: '700', marginTop: px(6), textAlign: 'center' },
    score: { color: '#fff', fontSize: px(46), fontWeight: '900', flexShrink: 0, marginHorizontal: px(8) },
    scoreLong: { fontSize: px(34) },
    chan: { color: '#fff', fontSize: px(20), fontWeight: '600', paddingHorizontal: px(16), paddingBottom: px(12), opacity: 0.95 },
    noBadge: { backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    noBadgeText: { color: '#fff', fontWeight: '900' },
    bigTeams: { position: 'absolute', right: px(120), top: px(250), flexDirection: 'row', alignItems: 'center' },
    goBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: px(16) },
    goIcon: { fontSize: px(54) },
    goTitle: { color: '#fff', fontSize: px(30), fontWeight: '900', marginTop: px(8), textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: px(6) },
    goSub: { color: '#fff', fontSize: px(20), opacity: 0.9, marginTop: px(6), textAlign: 'center' },
    bigVs: { color: '#fff', fontSize: px(80), fontWeight: '900', marginHorizontal: px(50), opacity: 0.9 },
    soloMid: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(16) },
    soloPoster: { width: px(196), height: px(110), borderRadius: px(6), marginRight: px(16), backgroundColor: 'rgba(0,0,0,0.3)' },
    soloText: { flex: 1, minWidth: 0 },
    soloTextCenter: { alignItems: 'center' },
    soloSport: { color: '#fff', fontSize: px(32), fontWeight: '900' },
    soloEv: { color: '#fff', fontSize: px(21), fontWeight: '600', marginTop: px(4), opacity: 0.92 },
    center: { textAlign: 'center' },
  }),
);
