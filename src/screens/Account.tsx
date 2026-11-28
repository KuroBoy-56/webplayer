// Perfil (ícono del menú de arriba), como Roku: a la izquierda la línea (usuario, estado, vencimiento, conexiones,
// servidor, cuánto contenido tiene y el código del equipo); a la derecha los ajustes.
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import CategoryLock from '../components/CategoryLock';
import ChangePinDialog from '../components/ChangePinDialog';
import PinDialog from '../components/PinDialog';
import TeamsModal from '../components/TeamsModal';
import { Button } from '../components/ui';
import { catalog } from '../data/catalog';
import { panelSubmit } from '../api/panel';
import { hasMasterKey } from '../lib/aes';
import { Key, Lang, langChoice, setLang, t, takeLangChanged } from '../lib/i18n';
import { pref, setPref } from '../lib/storage';
import { brand, brandName, distChoice } from '../lib/tenant';
import { dateText, dateTimeText, demoLength } from '../lib/util';
import { useNav } from '../nav';
import { deviceDiag } from '../lib/deviceid';
import { deviceId, loadCatalog, loadCloud, logoutByHand, refreshCatalog, reloadCatalog, resetTenant, showNotice, useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';
import { APP_VERSION } from '../version';
import { osVersion } from '../lib/osversion';
import { cloudAlerts, FavLeague, leagueChoices, liveLeagues, liveLeaguesText, liveSport, liveSportName, liveTvOn, platformCards, savePrefs, setLiveLeagues, setLiveSport, setPlatformCards } from '../data/liveTv';
import { fetchSports, localSports } from '../data/sportsPanel';
import { features } from '../lib/tenant';

// los nombres se traducen al mostrarlos
const SUBS: [string, Key][] = [
  ['off', 'Desactivados'],
  ['es', 'Español'],
  ['en', 'Inglés'],
];
// idioma de la app: cada idioma con su propio nombre (no se traduce)
const APP_LANGS: ['auto' | Lang, string][] = [
  ['auto', ''],
  ['es', 'Español'],
  ['en', 'English'],
  ['pt', 'Português'],
  ['fr', 'Français'],
];
const langLabel = (k: string) => (k === 'auto' ? t('Automático (idioma del equipo)') : APP_LANGS.find(l => l[0] === k)?.[1] || '');

function Setting({ label, value, onPress, preferred }: { label: string; value: string; onPress: () => void; preferred?: boolean }) {
  return (
    <View style={s.set}>
      <Button label={label} value={value} width={px(1040)} big last preferred={preferred} onPress={onPress} />
    </View>
  );
}

// lista de idiomas de la app; al elegir uno se aplica enseguida (App vuelve a montar las pantallas)
function LangPicker({ onClose }: { onClose: () => void }) {
  const cur = langChoice();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.pickShade}>
        <View style={s.pickBox}>
          <Text style={s.pickTitle}>{t('Idioma de la app')}</Text>
          {APP_LANGS.map(([k]) => (
            <View key={k} style={s.set}>
              <Button
                label={(k === cur ? '✓  ' : '     ') + langLabel(k)}
                left
                last
                preferred={k === cur}
                onPress={() => {
                  onClose();
                  setLang(k);
                }}
              />
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

// Cuenta › Deporte favorito: «Todos los deportes» o una de las disciplinas que da el panel (api/sports.php: las de la
// agenda y todas las encendidas); con una elegida, «En vivo ahora» de Inicio solo muestra esa
function SportPicker({ onClose }: { onClose: () => void }) {
  const [sports, setSports] = useState<Record<string, { label?: string; icon?: string }> | null>(() => localSports()?.sports || null);
  useEffect(() => {
    fetchSports().then(d => d && setSports(d.sports)).catch(() => {});
  }, []);
  const cur = liveSport();
  const list: [string, string][] = [
    ['', t('Todos los deportes')],
    ...Object.entries(sports || {})
      .map(([k, v]) => [k, ((v?.icon ? v.icon + ' ' : '') + String(v?.label || k)).trim()] as [string, string])
      .sort((a, b) => a[1].replace(/^\S+ /, '').localeCompare(b[1].replace(/^\S+ /, ''))),
  ];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.pickShade}>
        <View style={s.pickBox}>
          <Text style={s.pickTitle}>{t('Deporte favorito')}</Text>
          <Text style={s.pickNote}>{t('En Inicio, «En vivo ahora» muestra solo los partidos y eventos de esta disciplina.')}</Text>
          {!sports ? <Text style={s.pickNote}>{t('Cargando…')}</Text> : null}
          <ScrollView style={{ maxHeight: px(560) }}>
            {list.map(([k, label]) => (
              <View key={k || 'all'} style={s.set}>
                <Button
                  label={(k.toLowerCase() === cur.toLowerCase() ? '✓  ' : '     ') + label}
                  left
                  last
                  preferred={k.toLowerCase() === cur.toLowerCase()}
                  onPress={() => {
                    setLiveSport(k, k ? label : '');
                    // en la nube: el celular, la computadora y las otras TV de la línea y el perfil lo ven
                    savePrefs();
                    onClose();
                  }}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Cuenta › Eventos favoritos (ligas y copas internacionales del deporte favorito): varios a la vez (de la agenda y de los próximos 21 días, las que juegan hoy primero);
// con alguna elegida, «En vivo ahora» de Inicio solo muestra partidos de esas ligas
function LeaguePicker({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<(FavLeague & { today: number })[] | null>(null);
  const [sel, setSel] = useState<FavLeague[]>(() => liveLeagues());
  useEffect(() => {
    leagueChoices().then(setList).catch(() => setList([]));
  }, []);
  const save = (next: FavLeague[]) => {
    setSel(next);
    setLiveLeagues(next);
    savePrefs();
  };
  const sports = localSports()?.sports || {};
  const spName = (sp: string) => String(sports[sp]?.label || sp);
  const on = (id: string) => sel.some(x => x.id === id);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.pickShade}>
        <View style={s.pickBox}>
          <Text style={s.pickTitle}>{t('Eventos favoritos')}</Text>
          {!liveSport() ? (
            <Text style={s.pickNote}>{t('Primero elige tu deporte favorito para elegir tus eventos.')}</Text>
          ) : (
          <>
          <Text style={s.pickNote}>
            {t('En Inicio, «En vivo ahora» muestra solo los partidos de los eventos que elijas.')}
            {'  ' + t('Solo los de {x}.', { x: liveSportName() || liveSport() })}
          </Text>
          {!list ? <Text style={s.pickNote}>{t('Cargando…')}</Text> : null}
          {list && !list.length ? <Text style={s.pickNote}>{t('El panel todavía no tiene eventos para elegir.')}</Text> : null}
          <ScrollView style={{ maxHeight: px(560) }}>
            <View style={s.set}>
              <Button label={(sel.length ? '     ' : '✓  ') + t('Todos los eventos')} left last preferred onPress={() => save([])} />
            </View>
            {(list || []).map(x => (
              <View key={x.id} style={s.set}>
                <Button
                  label={
                    (on(x.id) ? '✓  ' : '     ') +
                    x.n +
                    (liveSport() ? '' : '  ·  ' + spName(x.sp)) +
                    (x.today ? '  ·  ' + t('{n} hoy', { n: x.today }) : '')
                  }
                  left
                  last
                  onPress={() => save(on(x.id) ? sel.filter(y => y.id !== x.id) : [...sel, { id: x.id, n: x.n, b: x.b, sp: x.sp }])}
                />
              </View>
            ))}
          </ScrollView>
          </>
          )}
          <View style={{ height: px(20) }} />
          <Button label={t('Listo')} primary last preferred={!liveSport()} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function cycle(list: string[][], cur: string): string {
  const i = list.findIndex(x => x[0] === cur);
  return list[(i + 1) % list.length][0];
}

export default function Account() {
  const nav = useNav();
  const st = useAppState();
  const [, force] = useState(0);
  // lo último de la nube (el deporte y los eventos favoritos elegidos en otro equipo de la línea y el perfil)
  useEffect(() => {
    if (liveTvOn()) cloudAlerts(true).then(() => force(x => x + 1)).catch(() => {});
  }, []);
  // para qué se pidió el PIN (como Roku): mostrar adultos, bloquear categorías o desbloquear lo protegido en la sesión
  const [pinFor, setPinFor] = useState<'' | 'adult' | 'blocked' | 'unlock'>('');
  const [catLock, setCatLock] = useState(false);
  const [changePin, setChangePin] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  const [reg, setReg] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [sportOpen, setSportOpen] = useState(false);
  const [leagueOpen, setLeagueOpen] = useState(false);
  // recién cambiado el idioma: el foco vuelve a esa fila
  const [langFocus] = useState(takeLangChanged);
  const s0 = st.session;
  const subs = pref('subs_lang', 'off');
  const hideAdult = pref('hide_adult', '1') === '1';
  const dist = brand();
  // cantidad de contenido del servidor ("…" mientras se carga esa lista)
  const count = (k: 'live' | 'vod' | 'series') => (st.loaded[k] ? String(catalog.k[k]?.index.size ?? 0) : '…');
  const missing = !st.loaded.live || !st.loaded.vod || !st.loaded.series;
  useEffect(() => {
    if (s0 && missing && !st.loading) loadCatalog();
  }, [s0, missing, st.loading]);

  const user = st.demo ? 'DEMO' : s0?.user || '';
  const soon = !!s0 && s0.exp > 0 && s0.exp < Date.now() / 1000 + 2 * 86400;
  const line = (label: Key, value: string) => (
    <Text style={s.row} numberOfLines={1}>
      {t(label)} <Text style={s.val}>{value}</Text>
    </Text>
  );
  return (
    <View style={s.root}>
      {s0 ? (
        <View style={s.card}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user.slice(0, 1).toUpperCase()}</Text>
          </View>
          {/* DEMO: nunca el usuario de la línea */}
          <Text style={s.user} numberOfLines={1}>{st.demo ? t('Usuario:') + ' DEMO' : user}</Text>
          <Text style={[s.plan, soon && !st.demo && s.planSoon]}>
            {st.demo ? t('Cuenta DEMO') + (demoLength(st.demoDuration) ? ' · ' + demoLength(st.demoDuration) : '') : soon ? t('Vence pronto') : t('Cuenta activa')}
          </Text>
          <View style={s.details}>
            {/* DEMO: solo el fin que dice el panel (hora exacta); nada de la línea demo del servidor */}
            {st.demo ? (
              line('Vence:', st.demoExpires > 0 ? dateTimeText(st.demoExpires) : '—')
            ) : (
              <>
                {line('Vence:', dateText(s0.exp))}
                {line('Conexiones:', t('{a} de {b}', { a: s0.active || '0', b: s0.max || '1' }))}
                {s0.created > 0 ? line('Desde:', dateText(s0.created)) : null}
                {line('Servidor:', s0.dns)}
              </>
            )}
            {line('Canales en vivo:', count('live'))}
            {line('Películas:', count('vod'))}
            {line('Series:', count('series'))}
            {dist ? line('Distribuidor:', dist.name ? dist.name + ' (' + dist.code + ')' : dist.code) : null}
          </View>
          <View style={s.macBox}>
            <Text style={s.macLabel}>{t('Código del equipo (MAC)')}</Text>
            <Text style={s.mac}>{deviceId() || deviceDiag()}</Text>
          </View>
        </View>
      ) : null}
      <ScrollView style={s.right} contentContainerStyle={s.rightIn}>
      <Text style={s.sub}>{t('Ajustes')}</Text>
      <Setting label={t('Idioma de la app')} value={langLabel(langChoice())} preferred={langFocus} onPress={() => setLangOpen(true)} />
      <Setting
        label={t('Subtítulos')}
        value={t(SUBS.find(a => a[0] === subs)?.[1] || 'Desactivados')}
        onPress={() => {
          setPref('subs_lang', cycle(SUBS, subs));
          force(x => x + 1);
        }}
      />
      <Setting
        label={t('PIN de control parental')}
        value={pinMsg || t('Activado · lo administra el panel (Cambiar)')}
        onPress={() => setChangePin(true)}
      />
      {/* control parental como Roku: adultos visibles u ocultos, categorías bloqueadas y lo protegido en esta sesión */}
      <Setting
        label={t('Canales y categorías para adultos')}
        value={hideAdult ? t('Ocultos') : t('Visibles')}
        onPress={() => {
          if (hideAdult) setPinFor('adult');
          else {
            setPref('hide_adult', '1');
            refreshCatalog();
            force(x => x + 1);
          }
        }}
      />
      <Setting label={t('Bloquear categorías')} value="" onPress={() => setPinFor('blocked')} />
      {/* con perfiles y las plataformas del distribuidor: vuelven en Inicio debajo de «En vivo ahora» */}
      {liveTvOn() && features().platforms !== false ? (
        <Setting
          label={t('Habilitar tarjetas de plataformas')}
          value={platformCards() ? t('Activado: las plataformas van debajo de «En vivo ahora»') : t('Desactivado')}
          onPress={() => {
            setPlatformCards(!platformCards());
            force(x => x + 1);
          }}
        />
      ) : null}
      {/* con perfiles: los equipos favoritos se guardan en la nube (avisa el celular; en la TV, la campanita) */}
      {liveTvOn() ? <Setting label={t('Deporte favorito')} value={liveSport() ? liveSportName() || liveSport() : t('Todos los deportes')} onPress={() => setSportOpen(true)} /> : null}
      {liveTvOn() ? <Setting label={t('Eventos favoritos')} value={liveLeaguesText()} onPress={() => setLeagueOpen(true)} /> : null}
      {liveTvOn() ? <Setting label={t('Equipos favoritos')} value={t('Elegir')} onPress={() => setTeamsOpen(true)} /> : null}
      <Setting
        label={t('Contenido protegido en esta sesión')}
        value={catalog.unlocked ? t('Desbloqueado') : t('Bloqueado')}
        onPress={() => {
          if (!catalog.unlocked) setPinFor('unlock');
          else {
            catalog.unlocked = false;
            refreshCatalog();
            force(x => x + 1);
          }
        }}
      />
      {hasMasterKey() && s0 ? (
        <Setting
          label={t('Registrar este equipo en el panel')}
          value={reg || t('Código {x}', { x: deviceId() })}
          onPress={() => {
            setReg(t('Registrando…'));
            panelSubmit(deviceId(), s0.user, s0.pass, s0.base).then(r => setReg(r.ok ? t('Equipo registrado') : r.error || t('No se pudo registrar')));
          }}
        />
      ) : null}
      <Setting
        label={t('Actualizar catálogo')}
        value={t('Actualizar películas, series y canales')}
        onPress={() => {
          // como Roku: todo otra vez del servidor IPTV (lo de antes sigue en pantalla mientras baja)
          reloadCatalog();
          loadCloud();
        }}
      />
      <Setting
        label={t('Cambiar distribuidor')}
        value={distChoice() === 'code' ? t('Número {x}', { x: dist?.code || '' }) : t('Escribir un número de distribuidor')}
        onPress={() => {
          resetTenant();
          nav.rebrand({ name: 'distributor' });
        }}
      />
      <Setting
        label={t('Cerrar sesión')}
        value=""
        onPress={() => {
          logoutByHand();
          nav.reset({ name: 'login' });
        }}
      />
      <Text style={s.ver}>{t('{x} para {p} · versión {v}', { x: brandName(), p: 'Fire TV (Vega OS ' + (osVersion() || '?') + ')', v: APP_VERSION })}</Text>
      </ScrollView>
      <ChangePinDialog
        visible={changePin}
        onClose={() => setChangePin(false)}
        onSaved={() => {
          setChangePin(false);
          setPinMsg(t('PIN guardado en el panel'));
        }}
      />
      <PinDialog
        visible={!!pinFor}
        sub={pinFor === 'adult' ? t('Ingresa el PIN para mostrar contenido para adultos') : pinFor === 'blocked' ? t('Ingresa el PIN para bloquear categorías') : t('Ingresa el PIN para desbloquear')}
        onClose={() => setPinFor('')}
        onOk={() => {
          const p = pinFor;
          setPinFor('');
          if (p === 'adult') {
            setPref('hide_adult', '0');
            refreshCatalog();
          } else if (p === 'unlock') {
            catalog.unlocked = true;
            refreshCatalog();
            showNotice(t('Contenido desbloqueado hasta que cierres la app'));
          } else if (p === 'blocked') setCatLock(true);
          force(x => x + 1);
        }}
      />
      {catLock ? (
        <CategoryLock
          onClose={changed => {
            setCatLock(false);
            if (changed) refreshCatalog();
          }}
        />
      ) : null}
      {langOpen ? <LangPicker onClose={() => setLangOpen(false)} /> : null}
      {teamsOpen ? <TeamsModal onClose={() => setTeamsOpen(false)} /> : null}
      {sportOpen ? <SportPicker onClose={() => setSportOpen(false)} /> : null}
      {leagueOpen ? <LeaguePicker onClose={() => setLeagueOpen(false)} /> : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, flexDirection: 'row', paddingTop: px(150), paddingLeft: SIDE, backgroundColor: C.bg },
    card: { width: px(620), height: px(860), backgroundColor: C.bg2, borderRadius: px(16), paddingHorizontal: px(40), paddingTop: px(40), alignItems: 'center' },
    avatar: { width: px(160), height: px(160), borderRadius: px(80), backgroundColor: C.red, justifyContent: 'center', alignItems: 'center' },
    avatarText: { color: C.onAccent, fontSize: px(80), fontWeight: '800' },
    user: { color: C.text, fontSize: px(38), fontWeight: '800', marginTop: px(22), maxWidth: px(540) },
    plan: { color: '#46D369', fontSize: px(28), fontWeight: '700', marginTop: px(8) },
    planSoon: { color: '#F5C518' },
    details: { alignSelf: 'stretch', marginTop: px(24) },
    row: { color: C.sub, fontSize: px(26), marginBottom: px(10) },
    val: { color: C.text, fontWeight: '700' },
    macBox: { position: 'absolute', left: px(30), right: px(30), bottom: px(30), height: px(130), borderRadius: px(12), backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
    macLabel: { color: C.dim, fontSize: px(24) },
    mac: { color: C.text, fontSize: px(32), fontWeight: '800', marginTop: px(6) },
    // margen a la izquierda y arriba: el ajuste enfocado crece un poco y su borde se cortaba contra el borde de la lista
    right: { flex: 1, marginLeft: px(26) },
    rightIn: { paddingLeft: px(24), paddingTop: px(6), paddingBottom: px(100), paddingRight: SIDE },
    sub: { color: C.text, fontSize: px(40), fontWeight: '800', marginBottom: px(18) },
    set: { marginBottom: px(12) },
    ver: { color: C.dim, fontSize: px(22), marginTop: px(40) },
    pickShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
    pickBox: { width: px(760), backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    pickTitle: { color: C.text, fontSize: px(44), fontWeight: '800', marginBottom: px(24) },
    pickNote: { color: C.sub, fontSize: px(26), marginBottom: px(18) },
  }),
);
