// Control parental › Bloquear categorías (como Roku): por tipo (Películas, Series, TV en vivo), OK en una categoría la
// bloquea o la desbloquea. Las bloqueadas se ocultan y piden el PIN (catalog.visibleCats / isCatLocked); se guardan en
// el equipo («blocked_cats»: "tipo:id"). Al cerrar, el catálogo se vuelve a armar si algo cambió.
import React, { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { catalog } from '../data/catalog';
import { Key, t } from '../lib/i18n';
import { readJson, writeJson } from '../lib/storage';
import { isAdult } from '../lib/util';
import { C, px, themed } from '../theme';
import { Button } from './ui';

type Kind = 'vod' | 'series' | 'live';
const KINDS: [Kind, Key][] = [
  ['vod', 'Películas'],
  ['series', 'Series'],
  ['live', 'TV en vivo'],
];

export default function CategoryLock({ onClose }: { onClose: (changed: boolean) => void }) {
  const [kind, setKind] = useState<Kind>('vod');
  const [blocked, setBlocked] = useState<string[]>(() => (readJson<string[]>('blocked_cats') || []).map(String));
  const [changed, setChanged] = useState(false);
  const cats = catalog.k[kind]?.cats || [];
  const toggle = (id: string) => {
    const k = kind + ':' + id;
    const next = blocked.includes(k) ? blocked.filter(x => x !== k) : [...blocked, k];
    setBlocked(next);
    writeJson('blocked_cats', next);
    setChanged(true);
  };
  const close = () => onClose(changed);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={s.shade}>
        <View style={s.box}>
          <Text style={s.title}>{t('Bloquear categorías')}</Text>
          <Text style={s.sub}>{t('Las categorías bloqueadas se ocultan y piden el PIN. Pulsa OK para bloquear o desbloquear.')}</Text>
          <View style={s.tabs}>
            {KINDS.map(([k, label], i) => (
              <Button key={k} label={t(label)} primary={k === kind} preferred={i === 0} last={i === KINDS.length - 1} onPress={() => setKind(k)} />
            ))}
          </View>
          <FlatList
            key={kind}
            style={s.list}
            data={cats}
            keyExtractor={c => c.id}
            initialNumToRender={12}
            windowSize={5}
            renderItem={({ item: c }) => {
              const on = blocked.includes(kind + ':' + c.id);
              return (
                <View style={s.row}>
                  <Button
                    label={(on ? '🔒  ' : '      ') + c.name}
                    value={on ? t('Bloqueada') : isAdult(c.name) ? t('Adultos') : ''}
                    width={px(1100)}
                    left
                    last
                    onPress={() => toggle(c.id)}
                  />
                </View>
              );
            }}
          />
          <View style={s.foot}>
            <Button label={t('Cerrar')} last onPress={close} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
    box: { width: px(1240), height: px(940), backgroundColor: C.bg2, borderRadius: px(16), padding: px(50) },
    title: { color: C.text, fontSize: px(46), fontWeight: '800' },
    sub: { color: C.sub, fontSize: px(26), marginTop: px(10), marginBottom: px(24) },
    tabs: { flexDirection: 'row', marginBottom: px(20) },
    list: { flex: 1 },
    row: { marginBottom: px(10) },
    foot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: px(20) },
  }),
);
