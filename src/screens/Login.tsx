// Inicio de sesión: solo usuario y contraseña; se prueba en todos los DNS del panel.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FakeScreen as Fake, lastFakeScreen, Line, panel, panelCheckMac, panelDemo, panelFeatures, panelDnsList, panelPlaylists, panelSubmit, resellerCode } from '../api/panel';
import FakeScreen from '../components/FakeScreen';
import KeyboardModal from '../components/KeyboardModal';
import { loginAll, sessionFrom } from '../api/xtream';
import { Button, Focusable, Logo } from '../components/ui';
import { json } from '../lib/http';
import { hasMasterKey } from '../lib/aes';
import { t, tmdbLang } from '../lib/i18n';
import { DNS_OPTIONS, dnsChoice, setDnsChoice } from '../lib/securedns';
import { read, write } from '../lib/storage';
import { APP_ID, features, scoped, tenantCode } from '../lib/tenant';
import { shuffle, str } from '../lib/util';
import { useNav } from '../nav';
import { deviceId, resetTenant, setSession } from '../state';
import { alpha, C, px, themed } from '../theme';
import { APP_VERSION } from '../version';

// fondo: carátulas de TMDB con la clave del panel (la del distribuidor o la del dueño) por
// api/tmdb.php (en el idioma de la app); sin clave el panel responde tmdb_key_not_set y no hay carrusel
async function tmdbPosters(): Promise<string[]> {
  const code = tenantCode();
  const tq = code ? '&t=' + encodeURIComponent(code) + '&app=' + APP_ID : '';
  const out: string[] = [];
  for (const path of ['movie/now_playing', 'trending/tv/week', 'movie/popular']) {
    const j = json<any>(await panel('tmdb.php', 'GET', '', '', '?path=' + path + '&language=' + tmdbLang() + tq));
    if (!j || j.error) break;
    for (const it of j.results || []) if (str(it.poster_path)) out.push('https://image.tmdb.org/t/p/w342' + it.poster_path);
    if (out.length >= 48) break;
  }
  return shuffle(out);
}

export default function Login() {
  const nav = useNav();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  // ojito: ver la contraseña en texto o volver a ocultarla
  const [showPass, setShowPass] = useState(false);
  // campo que se está escribiendo con el teclado de la app
  const [typing, setTyping] = useState<'user' | 'pass' | null>(null);
  const [dnsOpen, setDnsOpen] = useState(false);
  const [busy, setBusy] = useState(() => t('Comprobando el equipo en el panel…'));
  const [error, setError] = useState('');
  const [posters, setPosters] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<Line[]>([]);
  const passRef = useRef<TextInput>(null);
  const dev = deviceId();
  // pantalla falsa del panel (equipo nuevo): hasta escribir el código o hasta que lo registren
  const [fake, setFake] = useState<Fake | null>(null);
  // primera consulta al panel (línea del equipo y pantalla falsa) en curso: la pantalla falsa, si el
  // panel la tiene activada, es lo primero que se ve (nunca el inicio de sesión antes)
  const [checking, setChecking] = useState(true);
  // login.php features: hay demo configurada en el panel (null = no respondió o panel viejo)
  const [demoOk, setDemoOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // Cada vez que se abre la app: la línea del equipo se le pide al panel (nada guardado en el equipo).
    // Con una sola línea entra sola después de comprobarla en el servidor IPTV.
    (async () => {
      tmdbPosters().then(p => alive && setPosters(p));
      const feat = panelFeatures().then(f => alive && setDemoOk(f ? f.demo : null));
      // manda el panel: con la llave, check_mac primero (la línea que el panel le da hoy a esta MAC, demo
      // vigente incluida, con su marca DEMO). auth.php solo sin llave o si check_mac no da línea: prefiere
      // cualquier línea vieja no demo y no sabe si es demo (en Roku eso hacía rebotar el inicio).
      let lines: Line[] = [];
      let err = '';
      if (hasMasterKey()) {
        const ln = await panelCheckMac(dev);
        if (ln) lines = [ln];
      }
      if (!lines.length) {
        const r = await panelPlaylists(dev);
        lines = r.lines;
        err = r.error;
      }
      // el botón Autodemo ya se sabe antes de mostrar el inicio de sesión
      await feat;
      if (!alive) return;
      if (!lines.length && read('fake_unlocked') !== '1') setFake(lastFakeScreen());
      setChecking(false);
      setBusy('');
      if (lines.length) setAssigned(lines);
      if (lines.length === 1) enter(lines[0].user, lines[0].pass, [{ name: lines[0].name, base: lines[0].base }], true, lines[0].demo, lines[0].demoExpires, lines[0].demoDuration);
      else if (!lines.length && err) setError(err);
    })();
    return () => {
      alive = false;
    };
  }, [dev]);

  // con la pantalla falsa se pregunta cada 30 s: si registran el equipo, la app entra sola
  useEffect(() => {
    if (!fake) return;
    const t = setInterval(async () => {
      const ln = await panelCheckMac(dev);
      if (ln) {
        setFake(null);
        enter(ln.user, ln.pass, [{ name: ln.name, base: ln.base }], true, ln.demo, ln.demoExpires, ln.demoDuration);
      } else if (!lastFakeScreen()) setFake(null);
    }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fake, dev]);

  // fromPanel: la línea ya está registrada para este equipo (no se vuelve a registrar: si el dueño la
  // borró, el equipo no debe reaparecer solo). demo: línea DEMO (Autodemo o "demo": true del panel)
  const enter = async (
    u: string,
    p: string,
    servers?: { name: string; base: string }[],
    fromPanel = false,
    demo = false,
    demoExpires = 0,
    demoDuration = 0,
  ) => {
    if (!u.trim() || !p.trim()) {
      setError(t('Escribe tu usuario y contraseña'));
      return;
    }
    setError('');
    setBusy(t('Buscando tu cuenta en los servidores…'));
    const list = servers || (await panelDnsList());
    let r = await loginAll(list, u.trim(), p.trim());
    // línea que dio el panel (del equipo o de la Autodemo) y su servidor no contestó: la misma cuenta en los
    // DNS del panel y, si ninguno la rechazó (solo no contestaron), se entra con ella igual (como la app de
    // escritorio); el catálogo lo vuelve a intentar. Solo un rechazo del servidor deja en el inicio de sesión.
    if (!r.session && r.offline && (fromPanel || demo) && servers?.length) {
      setBusy(t('Buscando tu cuenta en los servidores…'));
      const dns = await panelDnsList();
      if (dns.length) r = await loginAll([...servers, ...dns], u.trim(), p.trim());
      if (!r.session && r.offline) r = { session: sessionFrom(servers[0], u.trim(), p.trim(), {}) };
    }
    if (r.session && hasMasterKey() && !fromPanel && !demo) {
      // usuario y contraseña escritos: el panel los registra en Cuentas oficiales y decide si entra
      // (una línea demo de otro equipo, vencida o borrada no pasa). 503 = el panel no llegó al
      // servidor IPTV, que la app sí validó.
      const reg = await panelSubmit(dev, r.session.user, r.session.pass, r.session.base).catch(() => ({ ok: false, code: 0, error: '' }));
      if (!reg.ok && reg.code !== 503) {
        setBusy('');
        setError(reg.error || t('No se pudo conectar con el panel. Revisa tu conexión a internet.'));
        return;
      }
    }
    setBusy('');
    if (r.session) {
      setSession(r.session, demo, demoExpires, demoDuration);
      nav.reset({ name: 'main' });
    } else {
      setError(r.error || t('No se pudo iniciar sesión'));
    }
  };

  const demo = async () => {
    // el panel decide (si el dueño borró el registro, el equipo puede pedir otra demo)
    setError('');
    // el código de un revendedor escrito en Contraseña deja la demo a su nombre en el panel
    const reseller = resellerCode(pass);
    setBusy(reseller ? t('Creando tu demo (revendedor {x})…', { x: reseller }) : t('Creando tu demo…'));
    const d = await panelDemo(dev, reseller);
    if (!d.ok) {
      setBusy('');
      // 404 (código de revendedor que no existe): la demo sigue disponible
      if (d.code === 403) write(scoped('demo_used'), '1');
      setError(d.error || t('No se pudo crear la demo'));
      return;
    }
    write(scoped('demo_used'), '1');
    // se entra con el servidor que acaba de dar el panel, las líneas del equipo y los DNS del panel
    // (loginAll prueba todos a la vez y en http y https)
    const pl = await panelPlaylists(dev);
    const own = pl.lines.filter(l => l.user === d.user).map(l => ({ name: l.name, base: l.base }));
    const dns = await panelDnsList();
    const servers = [...(d.url ? [{ name: 'Demo', base: d.url.replace(/\/+$/, '') }] : []), ...own, ...dns];
    await enter(d.user!, d.pass!, servers.length ? servers : undefined, false, true, d.expires || 0, d.duration || 0);
  };

  const enterAssigned = () => {
    const ln = assigned[0];
    enter(ln.user, ln.pass, assigned.filter(a => a.user === ln.user).map(a => ({ name: a.name, base: a.base })), true, ln.demo, ln.demoExpires, ln.demoDuration);
  };

  // Autodemo solo si el panel tiene una demo configurada; sin respuesta, lo de antes (con distribuidor
  // tenant_config; con Omitir se muestra)
  const canDemo = hasMasterKey() && (demoOk ?? features().demo);

  // vuelve al número de distribuidor (Continuar / Omitir): se olvidan la marca y la clave TMDB del anterior
  const changeDist = () => {
    if (busy) return;
    resetTenant();
    nav.rebrand({ name: 'distributor' });
  };

  if (checking && !fake) {
    return (
      <View style={s.checking}>
        <ActivityIndicator size="large" color={C.red} />
      </View>
    );
  }

  if (fake) {
    return (
      <FakeScreen
        screen={fake}
        device={dev}
        onUnlock={() => {
          write('fake_unlocked', '1');
          setFake(null);
        }}
      />
    );
  }

  return (
    <View style={s.root}>
      <PosterDrift posters={posters} />
      <View style={s.shade} />
      <View style={s.top}>
        <Logo size={110} />
      </View>
      <View style={s.center}>
        <View style={s.box}>
          <Text style={s.title}>{t('Iniciar sesión')}</Text>
          {/* usuario y contraseña con el teclado de la app (como Roku): un TextInput enfocado se quedaba con las flechas
              en algunos Fire TV y el foco no llegaba a Ingresar, DNS ni Cambiar distribuidor */}
          <Focusable preferred onPress={() => setTyping('user')} style={f => [s.input, s.field, f && s.fieldF]}>
            <Text style={[s.fieldText, !user && s.fieldPh]} numberOfLines={1}>
              {user || t('Usuario')}
            </Text>
          </Focusable>
          <View style={s.passRow}>
            <Focusable onPress={() => setTyping('pass')} style={f => [s.input, s.passInput, s.field, f && s.fieldF]}>
              <Text style={[s.fieldText, !pass && s.fieldPh]} numberOfLines={1}>
                {pass ? (showPass ? pass : '•'.repeat(pass.length)) : t('Contraseña')}
              </Text>
            </Focusable>
            <Focusable onPress={() => setShowPass(v => !v)} style={f => [s.eye, f && s.eyeF]}>
              <Eye open={showPass} />
            </Focusable>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {busy ? <Text style={s.busy}>{busy}</Text> : null}
          <View style={s.btns}>
            <Button label={busy ? t('Entrando…') : t('Ingresar')} primary onPress={() => !busy && enter(user, pass)} />
            <Button label="DNS" last={!canDemo} onPress={() => setDnsOpen(true)} />
            {canDemo ? <Button label="Autodemo" last onPress={() => !busy && demo()} /> : null}
          </View>
          {canDemo ? <Text style={s.tip}>{t('¿Tu revendedor te dio un código? Escríbelo en Contraseña y pulsa Autodemo.')}</Text> : null}
          {assigned.length ? (
            <View style={s.btns}>
              <Button label={t('Entrar con la cuenta de este equipo ({x})', { x: assigned[0].demo ? 'DEMO' : assigned[0].user })} small last onPress={() => !busy && enterAssigned()} />
            </View>
          ) : null}
          <Text style={s.device}>
            {t('Código del equipo:')} {dev}   ·   {t('Versión:')} {APP_VERSION}
          </Text>
        </View>
        <View style={s.dist}>
          <Button label={t('Cambiar distribuidor')} small last onPress={changeDist} />
        </View>
      </View>
      {dnsOpen ? <DnsPicker onClose={() => setDnsOpen(false)} /> : null}
      {typing ? (
        <KeyboardModal
          title={typing === 'user' ? t('Usuario') : t('Contraseña')}
          value={typing === 'user' ? user : pass}
          secret={typing === 'pass' && !showPass}
          onClose={() => setTyping(null)}
          onDone={v => {
            if (typing === 'user') setUser(v.trim());
            else setPass(v);
            setTyping(null);
          }}
        />
      ) : null}
    </View>
  );
}

// botón «DNS» (como Android e iOS): DNS seguro para saltar bloqueos del proveedor de internet
function DnsPicker({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState(dnsChoice().key);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  return (
    <View style={s.dnsShade} aria-modal>
      <View style={s.dnsBox}>
        <Text style={s.title}>DNS</Text>
        <Text style={s.dnsNote}>{t('Si tu internet bloquea el servidor, elige otro DNS. La app lo usa cuando el de tu red no responde.')}</Text>
        {/* si no caben, la lista se desplaza (el foco la corre con las flechas); aria-modal: el foco no sale del menú */}
        <ScrollView style={s.dnsList} contentContainerStyle={s.dnsItems}>
          {DNS_OPTIONS.map(o => (
            <Button
              key={o.key}
              label={(o.key === cur ? '✓ ' : '') + (o.key === 'auto' ? t('Automático') : o.label)}
              value={t(o.note)}
              preferred={o.key === cur}
              onPress={() => {
                setDnsChoice(o.key);
                setCur(o.key);
                onClose();
              }}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

// ojo dibujado (sin depender de las fuentes del equipo): tachado = contraseña oculta
function Eye({ open }: { open: boolean }) {
  return (
    <View style={s.eyeIcon}>
      <View style={s.eyeLid}>
        <View style={s.eyeDot} />
      </View>
      {open ? null : <View style={s.eyeSlash} />}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    dnsShade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha('#000000', 0.7), alignItems: 'center', justifyContent: 'center' },
    dnsBox: { width: px(820), maxHeight: '92%', backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    dnsList: { flexGrow: 0, flexShrink: 1 },
    // margen para que el borde del botón enfocado (crece un poco) no se corte en los lados
    dnsItems: { padding: px(10) },
    dnsNote: { color: C.sub, fontSize: px(26), marginBottom: px(24) },
    checking: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
    mosaic: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, transform: [{ rotate: '-8deg' }, { scale: 1.3 }] },
    mosaicBlock: { flexDirection: 'row', flexWrap: 'wrap' },
    mosaicImg: { width: px(192), height: px(288), margin: px(4), borderRadius: px(6) },
    shade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(C.bg, 0.72) },
    top: { position: 'absolute', left: px(80), top: px(40) },
    // la caja queda en el centro de la pantalla (a lo alto y a lo ancho)
    center: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    box: { width: px(760), backgroundColor: alpha(C.bg2, 0.9), borderRadius: px(12), padding: px(60) },
    title: { color: C.text, fontSize: px(52), fontWeight: '800', marginBottom: px(30) },
    // texto y ayuda («Usuario», «Contraseña») centrados a lo alto del campo
    input: { height: px(84), backgroundColor: C.card, borderRadius: px(8), color: C.text, fontSize: px(32), paddingHorizontal: px(24), paddingVertical: 0, textAlignVertical: 'center', marginBottom: px(22) },
    // el ojito al lado del campo (no encima): el foco del control llega a los dos sin confundirse
    passRow: { flexDirection: 'row', alignItems: 'flex-start' },
    passInput: { flex: 1 },
    field: { justifyContent: 'center', borderWidth: px(3), borderColor: 'transparent' },
    fieldF: { borderColor: C.text, backgroundColor: alpha(C.text, 0.12) },
    fieldText: { color: C.text, fontSize: px(32) },
    fieldPh: { color: C.dim },
    eye: { width: px(96), height: px(84), marginLeft: px(12), borderRadius: px(8), alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderWidth: px(3), borderColor: 'transparent' },
    eyeF: { backgroundColor: alpha(C.text, 0.2), borderWidth: px(3), borderColor: C.text },
    eyeIcon: { width: px(52), height: px(34), alignItems: 'center', justifyContent: 'center' },
    eyeLid: { width: px(48), height: px(30), borderRadius: px(24), borderWidth: px(4), borderColor: C.text, alignItems: 'center', justifyContent: 'center' },
    eyeDot: { width: px(12), height: px(12), borderRadius: px(6), backgroundColor: C.text },
    eyeSlash: { position: 'absolute', width: px(58), height: px(4), borderRadius: px(2), backgroundColor: C.text, transform: [{ rotate: '-35deg' }] },
    error: { color: '#e87c03', fontSize: px(26), marginBottom: px(14) },
    busy: { color: C.sub, fontSize: px(26), marginBottom: px(14) },
    btns: { flexDirection: 'row', marginTop: px(12) },
    tip: { color: C.dim, fontSize: px(22), marginTop: px(14) },
    device: { color: C.dim, fontSize: px(24), marginTop: px(30) },
    dist: { alignSelf: 'center', marginTop: px(24) },
  }),
);

/**
 * Carrusel del login: el mosaico de carátulas sube despacio sin fin. Tres copias iguales apiladas; al
 * subir una copia entera vuelve a 0 y la imagen es la misma (sin salto ni hueco abajo).
 */
function PosterDrift({ posters }: { posters: string[] }) {
  const drift = useRef(new Animated.Value(0)).current;
  const [blockH, setBlockH] = useState(0);
  useEffect(() => {
    if (!blockH) return;
    drift.setValue(0);
    const a = Animated.loop(Animated.timing(drift, { toValue: -blockH, duration: blockH * 45, easing: Easing.linear, useNativeDriver: true }));
    a.start();
    return () => a.stop();
  }, [blockH, drift]);
  if (!posters.length) return null;
  // al menos 48 carátulas por copia: con pocas, la copia es más baja que la pantalla
  const list: string[] = [];
  while (list.length < 48) list.push(...posters.slice(0, 40));
  const block = (k: number) => (
    <View key={k} style={s.mosaicBlock} onLayout={k === 0 ? e => setBlockH(Math.round(e.nativeEvent.layout.height)) : undefined}>
      {list.map((u, i) => <Image key={i} source={{ uri: u }} style={s.mosaicImg} />)}
    </View>
  );
  return (
    <View style={s.mosaic} pointerEvents="none">
      <Animated.View style={{ transform: [{ translateY: drift }] }}>{[0, 1, 2].map(block)}</Animated.View>
    </View>
  );
}
