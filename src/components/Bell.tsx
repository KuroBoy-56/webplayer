// La campanita de la barra de la TV (solo con perfiles). Al entrar a la app (o al volver a ella) y al pasar de una
// página a otra, si hay un aviso nuevo de hoy de un equipo favorito o de un partido marcado («¡En vivo! Real Madrid 1-0
// Barcelona», «Hoy 20:00: …», «Final: …»), baja desde la campanita un cartelito con OK: el foco va a OK y, al
// presionarlo (o Atrás), el cartel se va y el foco vuelve a donde estaba (el menú o el contenido). Cada aviso sale una
// vez por fase: el mismo partido vuelve a avisar cuando empieza y cuando termina. Con OK sobre la campanita se abre la
// lista de hoy, o «No hay notificaciones.». Se vuelve a mirar cada 10 minutos y al cambiar de página (como mucho cada
// minuto). En la TV no hay notificaciones del sistema (las da la app del celular).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Focusable } from './ui';
import { bellMarkSeen, bellMessages, BellMsg, bellUnseen } from '../data/liveTv';
import { useAppState } from '../state';
import { t } from '../lib/i18n';
import { C, px, themed } from '../theme';

let lastRun = 0;

// el elemento que tenía el foco antes del cartel (la TV web): vuelve ahí al cerrarlo, sin esperar a web/spatial.ts
const doc: any = (globalThis as any).document;
const activeEl = (): any => (doc ? doc.activeElement : null);
const refocus = (el: any) => {
  if (!el || !doc) return;
  setTimeout(() => {
    if (el.isConnected && el !== doc.body) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
  }, 80);
};

export default function Bell({ profile, iconStyle, focusStyle, active = true, section = '' }: { profile: string; iconStyle: any; focusStyle: any; active?: boolean; section?: string }) {
  const [msgs, setMsgs] = useState<BellMsg[]>([]);
  const [fresh, setFresh] = useState<BellMsg[]>([]);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const ref = useRef<View>(null);
  const alive = useRef(true);
  const before = useRef<any>(null);
  const run = useCallback(() => {
    lastRun = Date.now();
    bellMessages()
      .then(m => {
        if (!alive.current) return;
        setMsgs(m);
        setFresh(bellUnseen(profile, m));
      })
      .catch(() => {});
  }, [profile]);
  useEffect(() => {
    alive.current = true;
    run();
    const id = setInterval(run, 600000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [run]);
  // otra página (o de vuelta de una ficha / del reproductor): se mira otra vez si pasó un minuto
  useEffect(() => {
    if (active && Date.now() - lastRun > 60000) run();
  }, [active, section, run]);
  const { alertOpen } = useAppState();
  const banner = active && !open && !alertOpen && fresh.length > 0;
  useEffect(() => {
    if (!banner) return;
    before.current = activeEl();
    ref.current?.measureInWindow?.((x, y, w, h) => alive.current && w > 0 && setAt({ x, y, w, h }));
  }, [banner]);
  const closeBanner = () => {
    bellMarkSeen(profile, fresh);
    setFresh([]);
    refocus(before.current);
  };
  const openList = () => {
    before.current = activeEl();
    bellMarkSeen(profile, msgs);
    setFresh([]);
    setOpen(true);
  };
  const closeList = () => {
    setOpen(false);
    refocus(before.current);
  };
  // Atrás cierra el cartel o la lista (en la TV web Atrás no llega al Modal; en Vega también lo cierra onRequestClose)
  useEffect(() => {
    if (!banner && !open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open) closeList();
      else closeBanner();
      return true;
    });
    return () => sub.remove();
  });
  // debajo de la campanita, alineado a su borde derecho (sin medirla: arriba a la derecha)
  const W = px(640);
  const left = at ? Math.max(px(40), Math.min(at.x + at.w - W, px(1920) - W - px(40))) : px(1920) - W - px(80);
  const top = at ? Math.max(px(24), at.y + at.h + px(16)) : px(100);
  const arrow = at ? Math.max(px(24), Math.min(at.x + at.w / 2 - left - px(11), W - px(46))) : W - px(60);
  return (
    <View ref={ref} collapsable={false}>
      <Focusable onPress={openList} style={f => [iconStyle, f && focusStyle]}>
        {f => (
          <>
            <Image source={require('../../assets/image/ic_bell.png')} style={[s.img, { tintColor: f ? C.onFocus : '#fff' }]} resizeMode="contain" />
            {msgs.length ? <View style={s.dot} /> : null}
          </>
        )}
      </Focusable>
      {banner ? (
        <Modal visible transparent animationType="fade" onRequestClose={closeBanner}>
          <View style={s.fill}>
            <View style={[s.banner, { left, top, width: W }]}>
              <View style={[s.arrow, { left: arrow }]} />
              <View style={s.bannerHead}>
                <Image source={require('../../assets/image/ic_bell.png')} style={s.bannerIcon} resizeMode="contain" />
                <Text style={s.bannerTitle}>{t('Notificaciones')}</Text>
              </View>
              {fresh.slice(0, 3).map(m => (
                <Text key={m.key + ':' + m.order} style={s.bannerText} numberOfLines={2}>{m.text}</Text>
              ))}
              {fresh.length > 3 ? <Text style={s.bannerMore}>{t('y {n} más', { n: fresh.length - 3 })}</Text> : null}
              <View style={s.bannerBtns}>
                <Button label={t('OK')} preferred last width={px(180)} onPress={closeBanner} />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={closeList}>
          <View style={s.shade}>
            <View style={s.box}>
              <Text style={s.title}>{t('Notificaciones')}</Text>
              {msgs.length ? (
                msgs.slice(0, 10).map((m, i) => (
                  <View key={m.key} style={s.row}>
                    <Button label={m.text} left last width={px(760)} preferred={i === 0} onPress={closeList} />
                  </View>
                ))
              ) : (
                <View style={s.row}>
                  <Button label={t('No hay notificaciones.')} left last width={px(760)} preferred onPress={closeList} />
                </View>
              )}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    img: { width: px(40), height: px(40) },
    dot: { position: 'absolute', right: px(8), top: px(8), width: px(14), height: px(14), borderRadius: px(7), backgroundColor: C.red },
    fill: { flex: 1 },
    banner: { position: 'absolute', backgroundColor: 'rgba(24,24,24,0.97)', borderRadius: px(12), paddingHorizontal: px(28), paddingTop: px(22), paddingBottom: px(20), borderWidth: px(2), borderColor: 'rgba(255,255,255,0.14)' },
    arrow: { position: 'absolute', top: px(-12), width: px(22), height: px(22), backgroundColor: 'rgba(24,24,24,0.97)', transform: [{ rotate: '45deg' }], borderLeftWidth: px(2), borderTopWidth: px(2), borderColor: 'rgba(255,255,255,0.14)' },
    bannerHead: { flexDirection: 'row', alignItems: 'center', marginBottom: px(10) },
    bannerIcon: { width: px(30), height: px(30), tintColor: C.red, marginRight: px(12) },
    bannerTitle: { color: C.sub, fontSize: px(24), fontWeight: '700' },
    bannerText: { color: '#fff', fontSize: px(28), fontWeight: '700', marginBottom: px(8) },
    bannerMore: { color: C.sub, fontSize: px(22), marginBottom: px(6) },
    bannerBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: px(8) },
    shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'flex-end', paddingTop: px(110), paddingRight: px(80) },
    box: { width: px(860), backgroundColor: C.bg2, borderRadius: px(12), padding: px(40) },
    title: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(18) },
    row: { marginBottom: px(12) },
  }),
);
