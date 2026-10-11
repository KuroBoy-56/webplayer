// Inicio de sesión: solo usuario y contraseña; se prueba en todos los DNS del panel.
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { FakeScreen as Fake, lastFakeScreen, panelCheckMac, panelDemo, panelDnsList, panelPlaylists, panelSubmit, resellerCode } from '../api/panel';
import FakeScreen from '../components/FakeScreen';
import { loginAll } from '../api/xtream';
import { Button, Logo } from '../components/ui';
import { http, json } from '../lib/http';
import { hasMasterKey } from '../lib/aes';
import { read, write } from '../lib/storage';
import { features, scoped } from '../lib/tenant';
import { shuffle, str } from '../lib/util';
import { useNav } from '../nav';
import { deviceId, setSession } from '../state';
import { alpha, C, px, themed } from '../theme';

async function tmdbPosters(): Promise<string[]> {
  const key = read(scoped('tmdb_key'));
  if (!key) return [];
  const out: string[] = [];
  for (const path of ['movie/now_playing', 'trending/tv/week', 'movie/popular']) {
    const j = json(await http('https://api.themoviedb.org/3/' + path + '?language=es-MX&api_key=' + encodeURIComponent(key), { timeout: 10000 }));
    for (const it of j?.results || []) if (str(it.poster_path)) out.push('https://image.tmdb.org/t/p/w342' + it.poster_path);
    if (out.length >= 48) break;
  }
  return shuffle(out);
}

export default function Login() {
  const nav = useNav();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState('Comprobando el equipo en el panel…');
  const [error, setError] = useState('');
  const [posters, setPosters] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<{ name: string; base: string; user: string; pass: string }[]>([]);
  const passRef = useRef<TextInput>(null);
  const dev = deviceId();
  // pantalla falsa del panel (equipo nuevo): hasta escribir el código o hasta que lo registren
  const [fake, setFake] = useState<Fake | null>(null);

  useEffect(() => {
    let alive = true;
    // Cada vez que se abre la app: la línea del equipo se le pide al panel (nada guardado en el equipo).
    // Con una sola línea entra sola después de comprobarla en el servidor IPTV.
    panelPlaylists(dev).then(async r => {
      if (!alive) return;
      tmdbPosters().then(p => alive && setPosters(p));
      let lines = r.lines;
      // con la llave: línea activada por código MAC en el panel
      if (!lines.length) {
        const ln = await panelCheckMac(dev);
        if (ln) lines = [ln];
        else if (read('fake_unlocked') !== '1') setFake(lastFakeScreen());
      }
      if (!alive) return;
      setBusy('');
      if (lines.length) setAssigned(lines);
      if (lines.length === 1) enter(lines[0].user, lines[0].pass, [{ name: lines[0].name, base: lines[0].base }], true);
      else if (!lines.length && r.error) setError(r.error);
    });
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
        enter(ln.user, ln.pass, [{ name: ln.name, base: ln.base }], true);
      } else if (!lastFakeScreen()) setFake(null);
    }, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fake, dev]);

  // fromPanel: la línea ya está registrada para este equipo (no se vuelve a registrar: si el dueño la
  // borró, el equipo no debe reaparecer solo)
  const enter = async (u: string, p: string, servers?: { name: string; base: string }[], fromPanel = false) => {
    if (!u.trim() || !p.trim()) {
      setError('Escribe tu usuario y contraseña');
      return;
    }
    setError('');
    setBusy('Buscando tu cuenta en los servidores…');
    const list = servers || (await panelDnsList());
    const r = await loginAll(list, u.trim(), p.trim());
    setBusy('');
    if (r.session) {
      // registra el código del equipo en el panel (igual que Android y Roku)
      if (hasMasterKey() && !fromPanel) panelSubmit(dev, r.session.user, r.session.pass, r.session.base).catch(() => {});
      setSession(r.session);
      nav.reset({ name: 'main' });
    } else {
      setError(r.error || 'No se pudo iniciar sesión');
    }
  };

  const demo = async () => {
    // el panel decide (si el dueño borró el registro, el equipo puede pedir otra demo)
    setError('');
    // el código de un revendedor escrito en Contraseña deja la demo a su nombre en el panel
    const reseller = resellerCode(pass);
    setBusy(reseller ? 'Creando tu demo de 24 horas (revendedor ' + reseller + ')…' : 'Creando tu demo de 24 horas…');
    const d = await panelDemo(dev, reseller);
    if (!d.ok) {
      setBusy('');
      // 404 (código de revendedor que no existe): la demo sigue disponible
      if (d.code === 403) write(scoped('demo_used'), '1');
      setError(d.error || 'No se pudo crear la demo');
      return;
    }
    write(scoped('demo_used'), '1');
    const pl = await panelPlaylists(dev);
    const own = pl.lines.filter(l => l.user === d.user);
    await enter(d.user!, d.pass!, own.length ? own.map(l => ({ name: l.name, base: l.base })) : undefined);
  };

  const enterAssigned = () => {
    const ln = assigned[0];
    enter(ln.user, ln.pass, assigned.filter(a => a.user === ln.user).map(a => ({ name: a.name, base: a.base })), true);
  };

  const canDemo = hasMasterKey() && features().demo;

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
      <View style={s.mosaic}>
        {posters.slice(0, 40).map((u, i) => (
          <Image key={i} source={{ uri: u }} style={s.mosaicImg} />
        ))}
      </View>
      <View style={s.shade} />
      <View style={s.top}>
        <Logo size={110} />
      </View>
      <View style={s.box}>
        <Text style={s.title}>Iniciar sesión</Text>
        <TextInput
          style={s.input}
          value={user}
          onChangeText={setUser}
          placeholder="Usuario"
          placeholderTextColor={C.dim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => passRef.current?.focus()}
          hasTVPreferredFocus
        />
        <TextInput
          ref={passRef}
          style={s.input}
          value={pass}
          onChangeText={setPass}
          placeholder="Contraseña"
          placeholderTextColor={C.dim}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={() => enter(user, pass)}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
        {busy ? <Text style={s.busy}>{busy}</Text> : null}
        <View style={s.btns}>
          <Button label={busy ? 'Entrando…' : 'Ingresar'} primary onPress={() => !busy && enter(user, pass)} />
          {canDemo ? <Button label="Autodemo" last onPress={() => !busy && demo()} /> : null}
        </View>
        {canDemo ? <Text style={s.tip}>¿Tu revendedor te dio un código? Escríbelo en Contraseña y pulsa Autodemo.</Text> : null}
        {assigned.length ? (
          <View style={s.btns}>
            <Button label={'Entrar con la cuenta de este equipo (' + assigned[0].user + ')'} small last onPress={() => !busy && enterAssigned()} />
          </View>
        ) : null}
        <Text style={s.device}>Código del equipo: {dev}</Text>
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    mosaic: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap', transform: [{ rotate: '-8deg' }, { scale: 1.3 }] },
    mosaicImg: { width: px(192), height: px(288), margin: px(4), borderRadius: px(6) },
    shade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha(C.bg, 0.72) },
    top: { position: 'absolute', left: px(80), top: px(40) },
    box: { alignSelf: 'center', marginTop: px(150), width: px(760), backgroundColor: alpha(C.bg2, 0.9), borderRadius: px(12), padding: px(60) },
    title: { color: C.text, fontSize: px(52), fontWeight: '800', marginBottom: px(30) },
    input: { height: px(84), backgroundColor: C.card, borderRadius: px(8), color: C.text, fontSize: px(32), paddingHorizontal: px(24), marginBottom: px(22) },
    error: { color: '#e87c03', fontSize: px(26), marginBottom: px(14) },
    busy: { color: C.sub, fontSize: px(26), marginBottom: px(14) },
    btns: { flexDirection: 'row', marginTop: px(12) },
    tip: { color: C.dim, fontSize: px(22), marginTop: px(14) },
    device: { color: C.dim, fontSize: px(24), marginTop: px(30) },
  }),
);
