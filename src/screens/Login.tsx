// Inicio de sesión: solo usuario y contraseña; se prueba en todos los DNS del panel.
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { panelCheckMac, panelDemo, panelDnsList, panelPlaylists, panelSubmit } from '../api/panel';
import { loginAll } from '../api/xtream';
import { Button, Logo } from '../components/ui';
import { http, json } from '../lib/http';
import { hasMasterKey } from '../lib/aes';
import { read, write } from '../lib/storage';
import { features, scoped } from '../lib/tenant';
import { shuffle, str } from '../lib/util';
import { useNav } from '../nav';
import { deviceId, setSession } from '../state';
import { C, px, themed } from '../theme';

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
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [posters, setPosters] = useState<string[]>([]);
  const [assigned, setAssigned] = useState<{ name: string; base: string; user: string; pass: string }[]>([]);
  const passRef = useRef<TextInput>(null);
  const dev = deviceId();

  useEffect(() => {
    let alive = true;
    // listas asignadas a este equipo en el panel (entra solo si hay una)
    panelPlaylists(dev).then(async r => {
      if (!alive) return;
      tmdbPosters().then(p => alive && setPosters(p));
      let lines = r.lines;
      // con la llave: línea activada por código MAC en el panel
      if (!lines.length) {
        const ln = await panelCheckMac(dev);
        if (ln) lines = [ln];
      }
      if (alive && lines.length) setAssigned(lines);
    });
    return () => {
      alive = false;
    };
  }, [dev]);

  const enter = async (u: string, p: string, servers?: { name: string; base: string }[]) => {
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
      if (hasMasterKey()) panelSubmit(dev, r.session.user, r.session.pass, r.session.base).catch(() => {});
      setSession(r.session);
      nav.reset({ name: 'main' });
    } else {
      setError(r.error || 'No se pudo iniciar sesión');
    }
  };

  const demo = async () => {
    if (read(scoped('demo_used')) === '1') {
      setError('La demo ya se usó en este equipo.');
      return;
    }
    setError('');
    setBusy('Creando tu demo de 24 horas…');
    const d = await panelDemo(dev);
    if (!d.ok) {
      setBusy('');
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
    enter(ln.user, ln.pass, assigned.filter(a => a.user === ln.user).map(a => ({ name: a.name, base: a.base })));
  };

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
          {hasMasterKey() && features().demo ? <Button label="Autodemo" onPress={() => !busy && demo()} /> : null}
        </View>
        {assigned.length ? (
          <View style={s.btns}>
            <Button label={'Entrar con la cuenta de este equipo (' + assigned[0].user + ')'} small onPress={() => !busy && enterAssigned()} />
          </View>
        ) : null}
        <Text style={s.device}>Código del equipo: {dev}</Text>
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    mosaic: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap', transform: [{ rotate: '-8deg' }, { scale: 1.3 }] },
    mosaicImg: { width: px(192), height: px(288), margin: px(4), borderRadius: px(6) },
    shade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.72)' },
    top: { position: 'absolute', left: px(80), top: px(40) },
    box: { alignSelf: 'center', marginTop: px(150), width: px(760), backgroundColor: 'rgba(0,0,0,0.78)', borderRadius: px(10), padding: px(60) },
    title: { color: '#fff', fontSize: px(52), fontWeight: '800', marginBottom: px(30) },
    input: { height: px(84), backgroundColor: '#333', borderRadius: px(6), color: '#fff', fontSize: px(32), paddingHorizontal: px(24), marginBottom: px(22) },
    error: { color: '#e87c03', fontSize: px(26), marginBottom: px(14) },
    busy: { color: C.sub, fontSize: px(26), marginBottom: px(14) },
    btns: { flexDirection: 'row', marginTop: px(12) },
    device: { color: C.dim, fontSize: px(24), marginTop: px(30) },
  }),
);
