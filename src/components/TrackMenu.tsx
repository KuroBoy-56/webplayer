// Menú del reproductor: audio y subtítulos (y favoritos en TV en vivo). Mismos botones que el resto.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MenuItem } from '../player/playback';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';
import { Button } from './ui';

export default function TrackMenu({ items, favLabel, onFav, onPick }: { items: MenuItem[]; favLabel: string; onFav: () => void; onPick: (m: MenuItem) => void }) {
  const audio = items.filter(m => m.kind !== 'text');
  const subs = items.filter(m => m.kind === 'text');
  const realAudio = audio.filter(m => m.kind === 'audio');
  // el foco empieza en lo que suena ahora
  const first = (favLabel ? null : realAudio.find(m => m.on) || audio[0] || subs.find(m => m.on) || subs[0]) || null;
  const row = (m: MenuItem) => (
    <View key={m.kind + m.key} style={s.opt}>
      <Button label={(m.on ? '✓  ' : '     ') + m.label} left last small={m.kind === 'panel'} preferred={m === first} onPress={() => onPick(m)} />
    </View>
  );
  return (
    <View style={s.menu}>
      <Text style={s.menuTitle}>{t('Audio y subtítulos')}</Text>
      <ScrollView>
        {favLabel ? (
          <View style={s.opt}>
            <Button label={favLabel} left last preferred onPress={onFav} />
          </View>
        ) : null}
        <Text style={s.head}>{t('Audio')}</Text>
        {realAudio.length ? null : <Text style={s.note}>{t('Audio predeterminado')}</Text>}
        {audio.map(row)}
        {realAudio.length === 1 ? <Text style={s.note}>{t('Este contenido tiene una sola pista de audio.')}</Text> : null}
        <Text style={s.head}>{t('Subtítulos')}</Text>
        {subs.map(row)}
      </ScrollView>
      <Text style={s.hint}>{t('Atrás para cerrar')}</Text>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    menu: { position: 'absolute', right: 0, top: 0, bottom: 0, width: px(700), backgroundColor: alpha(C.bg2, 0.96), paddingHorizontal: px(50), paddingTop: px(50), paddingBottom: px(30), zIndex: 10 },
    menuTitle: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(10) },
    head: { color: C.sub, fontSize: px(24), fontWeight: '800', marginTop: px(20), marginBottom: px(10), letterSpacing: px(2) },
    opt: { marginBottom: px(10), marginHorizontal: px(8) },
    note: { color: C.dim, fontSize: px(22), marginBottom: px(10) },
    hint: { color: C.sub, fontSize: px(24), marginTop: px(14) },
  }),
);
