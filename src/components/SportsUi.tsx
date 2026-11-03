// Piezas de Deportes (igual que Roku): chips, fila de partido, menú «¿Dónde quieres verlo?» con los canales del
// cliente en verde, teclado para buscar, ficha del equipo (Entendido / Más detalles) y lector del texto completo.
import React, { memo, useRef, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';
import { Button, Focusable } from './ui';

export const GREEN = '#46D369';

export function Chip({ label, on, onPress, preferred, onFocus }: { label: string; on: boolean; onPress: () => void; preferred?: boolean; onFocus?: () => void }) {
  return (
    <Focusable onPress={onPress} onFocus={onFocus} preferred={preferred} style={f => [s.chip, on && s.chipOn, f && s.chipF]}>
      {f => <Text style={[s.chipText, f && { color: C.onFocus }]}>{label}</Text>}
    </Focusable>
  );
}

export type EvRow = {
  key: string;
  time: string;
  live: boolean;
  league: string;
  lb: string;
  home: string;
  away: string;
  hb: string;
  ab: string;
  score: string;
  chan: string;
  hasChan: boolean;
  tv: string;
  e: any;
};

// preferred / onFocusKey: Deportes vuelve a poner el foco en el evento que se abrió (al volver del canal o al bajar
// desde el menú de arriba)
export const EventRow = memo(function EventRow({ r, onPress, preferred, onFocusKey }: { r: EvRow; onPress: () => void; preferred?: boolean; onFocusKey?: (k: string) => void }) {
  return (
    <Focusable onPress={onPress} preferred={preferred} onFocus={onFocusKey ? () => onFocusKey(r.key) : undefined} style={f => [s.ev, f && s.evF]}>
      {f => (
        <>
          <Text style={[s.time, r.live && s.timeLive, f && !r.live && { color: C.onFocus }]} numberOfLines={2}>
            {r.time}
          </Text>
          {r.lb ? <Image source={{ uri: r.lb }} style={s.lb} resizeMode="contain" /> : <View style={s.lb} />}
          <View style={s.mid}>
            <Text style={[s.league, f && { color: C.onFocus }]} numberOfLines={1}>
              {r.league}
            </Text>
            <View style={s.teams}>
              {r.hb ? <Image source={{ uri: r.hb }} style={s.badge} resizeMode="contain" /> : null}
              <Text style={[s.team, f && { color: C.onFocus }]} numberOfLines={1}>
                {r.home}
              </Text>
              {r.away ? <Text style={[s.score, f && { color: C.onFocus }]}>{r.score}</Text> : null}
              {r.away ? (
                <Text style={[s.team, f && { color: C.onFocus }]} numberOfLines={1}>
                  {r.away}
                </Text>
              ) : null}
              {r.ab ? <Image source={{ uri: r.ab }} style={s.badge} resizeMode="contain" /> : null}
            </View>
            {r.tv ? (
              <Text style={[s.tv, f && { color: C.onFocus }]} numberOfLines={1}>
                {r.tv}
              </Text>
            ) : null}
          </View>
          <Text style={[s.chan, { color: r.hasChan ? GREEN : C.dim }, f && { color: C.onFocus }]} numberOfLines={1}>
            {r.hasChan ? '▶ ' + r.chan : r.chan}
          </Text>
        </>
      )}
    </Focusable>
  );
});

export type MenuOpt = { title: string; sub?: string; green?: boolean; onPress: () => void };

/** menú vertical (Atrás cierra); green = canal que el cliente tiene en su lista */
export function MenuModal({ title, sub, opts, onClose }: { title: string; sub?: string; opts: MenuOpt[]; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.shade}>
        <View style={s.menu}>
          <Text style={s.menuTitle} numberOfLines={2}>
            {title}
          </Text>
          {sub ? <Text style={s.menuSub}>{sub}</Text> : null}
          <ScrollView style={{ maxHeight: px(640) }}>
            {opts.map((o, i) => (
              <Focusable key={i} onPress={o.onPress} preferred={i === 0} style={f => [s.menuRow, f && (o.green ? s.menuRowGreen : s.menuRowF)]}>
                {f => (
                  <>
                    <Text style={[s.menuRowTitle, o.green && { color: GREEN }, f && { color: o.green ? '#000' : C.onFocus }]} numberOfLines={1}>
                      {o.title}
                    </Text>
                    {o.sub ? (
                      <Text style={[s.menuRowSub, f && { color: o.green ? '#000' : C.onFocus }]} numberOfLines={1}>
                        {o.sub}
                      </Text>
                    ) : null}
                  </>
                )}
              </Focusable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** teclado: un nombre (equipo, canal o evento) */
export function InputModal({ title, initial, onSubmit, onClose }: { title: string; initial: string; onSubmit: (q: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const done = useRef(false);
  const send = () => {
    if (done.current) return;
    done.current = true;
    onClose();
    if (q.trim()) onSubmit(q.trim());
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.shade}>
        <View style={s.menu}>
          <Text style={s.menuTitle}>{title}</Text>
          <TextInput
            style={s.input}
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={send}
            placeholderTextColor={C.dim}
          />
          <View style={s.btns}>
            <Button label={t('Buscar')} primary onPress={send} />
            <Button label={t('Cancelar')} last onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** ficha del equipo: datos y un adelanto; ENTENDIDO (marcado, cierra) y MÁS DETALLES (texto completo) */
export function TeamCard({ title, image, text, onMore, onClose }: { title: string; image: string; text: string; onMore: () => void; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.shade}>
        <View style={[s.menu, s.card]}>
          {image ? <Image source={{ uri: image }} style={s.cardImg} resizeMode="contain" /> : null}
          <Text style={[s.menuTitle, s.center]}>{title}</Text>
          <Text style={s.cardText} numberOfLines={12}>
            {text}
          </Text>
          <View style={[s.btns, s.centerRow]}>
            <Button label={t('ENTENDIDO')} primary preferred onPress={onClose} />
            <Button label={t('MÁS DETALLES')} last onPress={onMore} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** texto completo: arriba y abajo para leer; OK o Atrás cierran */
export function ReadModal({ title, image, text, onClose }: { title: string; image: string; text: string; onClose: () => void }) {
  const ref = useRef<ScrollView>(null);
  const y = useRef(0);
  const max = useRef(0);
  const move = (d: number) => {
    y.current = Math.max(0, Math.min(max.current, y.current + d));
    ref.current?.scrollTo({ y: y.current, animated: true });
  };
  // arriba / abajo del control desplazan el texto (el foco se queda en Cerrar)
  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return;
    if (evt.eventType === 'up') move(-px(260));
    else if (evt.eventType === 'down') move(px(260));
  });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.shade}>
        <View style={s.read}>
          <View style={s.readHead}>
            {image ? <Image source={{ uri: image }} style={s.readImg} resizeMode="contain" /> : null}
            <Text style={s.menuTitle} numberOfLines={2}>
              {title}
            </Text>
          </View>
          <ScrollView
            ref={ref}
            style={s.readBox}
            onContentSizeChange={(_, h) => {
              max.current = Math.max(0, h - px(600));
            }}
            onScroll={ev => {
              y.current = ev.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={50}>
            <Text style={s.readText}>{text}</Text>
          </ScrollView>
          <View style={s.readNav}>
            <Button label={t('Cerrar')} small primary preferred last onPress={onClose} />
          </View>
          <Text style={s.hint}>{t('Arriba y abajo para leer · OK o Atrás para cerrar')}</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    chip: { height: px(56), paddingHorizontal: px(28), borderRadius: px(28), justifyContent: 'center', marginRight: px(14), backgroundColor: alpha(C.text, 0.12), borderWidth: px(3), borderColor: 'transparent' },
    chipOn: { borderColor: C.red },
    chipF: { backgroundColor: C.focus },
    chipText: { color: C.text, fontSize: px(26), fontWeight: '700' },
    ev: { height: px(140), flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderRadius: px(8), marginBottom: px(10), paddingHorizontal: px(24) },
    evF: { backgroundColor: C.focus, transform: [{ scale: 1.02 }] },
    time: { color: C.text, fontSize: px(26), fontWeight: '800', width: px(190) },
    timeLive: { color: C.red },
    lb: { width: px(56), height: px(56), marginRight: px(16) },
    mid: { flex: 1 },
    league: { color: C.sub, fontSize: px(22) },
    teams: { flexDirection: 'row', alignItems: 'center', marginTop: px(6) },
    badge: { width: px(42), height: px(42), marginHorizontal: px(10) },
    team: { color: C.text, fontSize: px(30), fontWeight: '700', maxWidth: px(440) },
    score: { color: C.text, fontSize: px(30), fontWeight: '800', marginHorizontal: px(20) },
    chan: { fontSize: px(24), fontWeight: '700', width: px(400), textAlign: 'right' },
    tv: { color: C.sub, fontSize: px(22), marginTop: px(6) },
    shade: { flex: 1, backgroundColor: alpha('#000000', 0.8), justifyContent: 'center', alignItems: 'center' },
    menu: { width: px(960), backgroundColor: C.bg2, borderRadius: px(14), padding: px(40) },
    menuTitle: { color: C.text, fontSize: px(36), fontWeight: '800' },
    menuSub: { color: C.sub, fontSize: px(24), marginTop: px(6), marginBottom: px(20) },
    menuRow: { paddingHorizontal: px(24), paddingVertical: px(16), borderRadius: px(8), marginBottom: px(10), backgroundColor: alpha(C.text, 0.1) },
    menuRowF: { backgroundColor: C.focus },
    menuRowGreen: { backgroundColor: GREEN },
    menuRowTitle: { color: C.text, fontSize: px(28), fontWeight: '700' },
    menuRowSub: { color: C.sub, fontSize: px(22), marginTop: px(4) },
    input: { height: px(84), backgroundColor: C.card, borderRadius: px(8), color: C.text, fontSize: px(34), paddingHorizontal: px(28), marginTop: px(24) },
    btns: { flexDirection: 'row', marginTop: px(30) },
    centerRow: { justifyContent: 'center' },
    center: { textAlign: 'center' },
    card: { alignItems: 'center' },
    cardImg: { width: px(180), height: px(180), marginBottom: px(16) },
    cardText: { color: C.sub, fontSize: px(28), lineHeight: px(40), textAlign: 'center', marginTop: px(16) },
    read: { width: px(1440), height: px(940), backgroundColor: C.bg2, borderRadius: px(14), padding: px(48) },
    readHead: { flexDirection: 'row', alignItems: 'center', marginBottom: px(20) },
    readImg: { width: px(110), height: px(110), marginRight: px(28) },
    readBox: { height: px(600), flexGrow: 0 },
    readText: { color: '#E5E5E5', fontSize: px(30), lineHeight: px(44) },
    readNav: { flexDirection: 'row', justifyContent: 'center', marginTop: px(20) },
    hint: { color: C.dim, fontSize: px(22), textAlign: 'center', marginTop: px(12) },
  }),
);
