// Navegación por pila: las pantallas de abajo quedan montadas (ocultas) para volver
// al mismo lugar al pulsar Atrás.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, StyleSheet, Text, View } from 'react-native';
import { fetchAlert, PanelAlert } from './api/alerts';
import AlertDialog from './components/AlertDialog';
import { Logo } from './components/ui';
import { loadStorage } from './lib/storage';
import { applyBrand, distChoice, features, onTenantProblem, tenantCode } from './lib/tenant';
import { Nav, NavContext, Route } from './nav';
import Actor from './screens/Actor';
import Detail from './screens/Detail';
import Distributor, { TenantRetry } from './screens/Distributor';
import Grid from './screens/Grid';
import Login from './screens/Login';
import Main from './screens/Main';
import Player from './screens/Player';
import { bindReportContext, installCrashReporter } from './api/report';
import { checkTenant, deviceId, getState, Guard, loadCatalog, loadCloud, logout, restoreSession, tenantCheckDue, useAppState } from './state';
import { panelAnswered, panelCheckMac } from './api/panel';

// errores al panel (Errores de las apps): cierres de JavaScript y fallos de reproducción
installCrashReporter();
bindReportContext(() => {
  const s = getState().session;
  return { device: deviceId(), user: s?.user || '', server: s?.base || '' };
});
import { alpha, C, px, themed } from './theme';

function Screen({ route, active }: { route: Route; active: boolean }) {
  switch (route.name) {
    case 'distributor':
      return <Distributor message={route.message} />;
    case 'tenant_retry':
      return <TenantRetry message={route.message} />;
    case 'login':
      return <Login />;
    case 'main':
      return <Main active={active} />;
    case 'detail':
      return <Detail item={route.item} />;
    case 'actor':
      return <Actor personId={route.personId} name={route.actorName} />;
    case 'grid':
      return <Grid title={route.title} mode={route.mode} keyName={route.key} kind={route.kind} />;
    case 'player':
      return <Player params={route.params} />;
  }
}

// aviso corto encima de todas las pantallas (p. ej. "No disponible en la DEMO")
function Notice() {
  const { notice } = useAppState();
  if (!notice) return null;
  return (
    <View style={s.notice} pointerEvents="none">
      <Text style={s.noticeText}>{notice}</Text>
    </View>
  );
}

export default function App() {
  const [stack, setStack] = useState<Route[] | null>(null);
  // pantalla de inicio: fondo y logo del distribuidor (o los de la app con Omitir)
  const [splash, setSplash] = useState(true);
  // cambia cuando cambian los colores: se vuelven a montar las pantallas con los nuevos estilos
  const [skin, setSkin] = useState(0);

  useEffect(() => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    loadStorage().then(() => {
      // marca guardada del distribuidor antes de la primera pantalla
      applyBrand();
      const logged = restoreSession();
      if (!distChoice()) setStack([{ name: 'distributor' }]);
      else setStack([logged ? { name: 'main' } : { name: 'login' }]);
      // el logo se ve al menos un momento (la primera pantalla ya se arma debajo)
      timer = setTimeout(() => setSplash(false), Math.max(0, 1500 - (Date.now() - started)));
    });
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // al entrar: catálogo y nube (progreso y Mi lista)
  const top = stack ? stack[0].name : '';
  // aviso del panel: una vez por arranque de la app y otra vez tras iniciar sesión
  const [alert, setAlert] = useState<PanelAlert | null>(null);
  const alertDone = useRef(false);
  useEffect(() => {
    const ses = getState().session;
    if (top === 'main' && ses) {
      loadCatalog();
      loadCloud();
      if (!alertDone.current) {
        alertDone.current = true;
        // el distribuidor puede tener los avisos apagados
        if (features().alerts) fetchAlert(ses).then(a => a && setAlert(a)).catch(() => {});
      }
    } else if (top === 'login' || top === 'distributor') {
      alertDone.current = false;
      setAlert(null);
    }
  }, [top]);

  // al volver a la app: Continuar viendo y Mi lista otra vez desde el panel (pudo verse en otra app)
  useEffect(() => {
    let last = Date.now();
    let lastPanel = Date.now();
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active' || !getState().session || Date.now() - last < 60000) return;
      last = Date.now();
      loadCloud();
      // como mucho cada 15 min: si el dueño quitó la línea de este equipo, vuelve al inicio de sesión
      if (Date.now() - lastPanel < 15 * 60000) return;
      lastPanel = Date.now();
      const ses = getState().session;
      panelCheckMac(deviceId()).then(ln => {
        if (!ln && panelAnswered() && getState().session === ses) {
          logout();
          setStack([{ name: 'login' }]);
        }
      });
    });
    return () => sub.remove();
  }, []);

  const nav: Nav = useMemo(
    () => ({
      push: r => setStack(s => [...(s || []), r]),
      pop: () => setStack(s => (s && s.length > 1 ? s.slice(0, -1) : s)),
      reset: r => setStack([r]),
      rebrand: r => {
        if (applyBrand()) setSkin(k => k + 1);
        setStack([r]);
      },
    }),
    [],
  );

  // guardián del distribuidor: al abrir, al volver a la app, cada recheck_after segundos y
  // cuando el panel rechaza el número en progreso, EPG o deportes
  const stackRef = useRef<Route[] | null>(null);
  stackRef.current = stack;
  const ready = !!stack;
  useEffect(() => {
    if (!ready) return;
    const handle = (g: Guard) => {
      if (g.kind === 'wiped') nav.rebrand({ name: 'distributor', message: g.message });
      else if (g.kind === 'retry') nav.rebrand({ name: 'tenant_retry', message: g.message });
      else if (g.kind === 'ok' && g.changed) {
        // colores nuevos solo si no interrumpe (nada abierto encima); si no, al próximo inicio
        const st = stackRef.current;
        if (st && st.length === 1) {
          if (applyBrand()) setSkin(k => k + 1);
        }
      }
    };
    const run = () => {
      if (tenantCode()) checkTenant().then(handle).catch(() => {});
    };
    run();
    onTenantProblem(run);
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && tenantCheckDue()) run();
    });
    const timer = setInterval(() => tenantCheckDue() && run(), 15 * 60000);
    return () => {
      sub.remove();
      clearInterval(timer);
      onTenantProblem(() => {});
    };
  }, [ready, nav]);

  const onBack = useCallback(() => {
    if (stack && stack.length > 1 && stack[stack.length - 1].name !== 'player') {
      nav.pop();
      return true;
    }
    return false;
  }, [stack, nav]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [onBack]);

  if (!stack) {
    // mientras se lee lo guardado: solo el fondo (aún no se sabe si hay un distribuidor)
    return <View style={s.root} />;
  }

  return (
    <NavContext.Provider value={nav}>
      <StatusBar hidden />
      <View key={skin} style={s.app}>
        {stack.map((r, i) => {
          const active = i === stack.length - 1;
          // el reproductor tapa todo; lo de abajo se oculta para que el foco no se escape
          return (
            <View key={i + r.name} style={[StyleSheet.absoluteFill, !active && s.hidden]}>
              <Screen route={r} active={active} />
            </View>
          );
        })}
      </View>
      {splash ? (
        <View style={[StyleSheet.absoluteFill, s.root]}>
          <Logo size={300} />
        </View>
      ) : (
        <AlertDialog alert={alert} onClose={() => setAlert(null)} />
      )}
      <Notice />
    </NavContext.Provider>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
    app: { flex: 1, backgroundColor: C.bg },
    hidden: { display: 'none' },
    notice: { position: 'absolute', bottom: px(120), alignSelf: 'center', maxWidth: px(1300), backgroundColor: alpha(C.bg2, 0.95), borderRadius: px(12), borderLeftWidth: px(6), borderLeftColor: C.red, paddingHorizontal: px(30), paddingVertical: px(16) },
    noticeText: { color: C.text, fontSize: px(28) },
  }),
);
