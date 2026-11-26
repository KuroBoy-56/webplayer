// La campanita de la barra de la TV (solo con perfiles): al entrar, si hoy juega un equipo favorito o un partido marcado,
// baja un mensajito unos segundos («¡En vivo! Real Madrid 1-0 Barcelona», «Hoy 20:00: …», «Final: …»); con OK se abre
// la lista de hoy. Se vuelve a mirar cada 10 minutos. En la TV no hay notificaciones (las da la app del celular).
import React, { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Focusable } from './ui';
import { bellMessages, BellMsg } from '../data/liveTv';
import { t } from '../lib/i18n';
import { C, px, themed } from '../theme';

const shownFor = new Set<string>();

export default function Bell({ profile, iconStyle, focusStyle }: { profile: string; iconStyle: any; focusStyle: any }) {
  const [msgs, setMsgs] = useState<BellMsg[]>([]);
  const [toast, setToast] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    let hide: any = 0;
    const run = () =>
      bellMessages().then(m => {
        if (!alive) return;
        setMsgs(m);
        if (m.length && !shownFor.has(profile)) {
          shownFor.add(profile);
          setToast(m[0].text + (m.length > 1 ? '   +' + (m.length - 1) : ''));
          hide = setTimeout(() => alive && setToast(''), 7000);
        }
      });
    run();
    const id = setInterval(run, 600000);
    return () => {
      alive = false;
      clearInterval(id);
      clearTimeout(hide);
    };
  }, [profile]);
  return (
    <View>
      <Focusable onPress={() => (setOpen(true), setToast(''))} style={f => [iconStyle, f && focusStyle]}>
        {f => (
          <>
            <Image source={require('../../assets/image/ic_bell.png')} style={[s.img, { tintColor: f ? C.onFocus : '#fff' }]} resizeMode="contain" />
            {msgs.length ? <View style={s.dot} /> : null}
          </>
        )}
      </Focusable>
      {toast ? (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText} numberOfLines={2}>{toast}</Text>
        </View>
      ) : null}
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={s.shade}>
            <View style={s.box}>
              <Text style={s.title}>{t('Avisos de hoy')}</Text>
              {msgs.length ? (
                msgs.slice(0, 10).map((m, i) => (
                  <View key={m.key} style={s.row}>
                    <Button label={m.text} left last width={px(760)} preferred={i === 0} onPress={() => setOpen(false)} />
                  </View>
                ))
              ) : (
                <View style={s.row}>
                  <Button label={t('Hoy no juega ninguno de tus equipos.')} left last width={px(760)} preferred onPress={() => setOpen(false)} />
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
    toast: { position: 'absolute', right: 0, top: px(78), width: px(620), backgroundColor: 'rgba(24,24,24,0.95)', borderRadius: px(10), paddingHorizontal: px(26), paddingVertical: px(18) },
    toastText: { color: '#fff', fontSize: px(26), fontWeight: '700' },
    shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'flex-end', paddingTop: px(110), paddingRight: px(80) },
    box: { width: px(860), backgroundColor: C.bg2, borderRadius: px(12), padding: px(40) },
    title: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(18) },
    row: { marginBottom: px(12) },
  }),
);
