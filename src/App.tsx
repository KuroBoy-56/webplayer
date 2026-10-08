// Navegación por pila: las pantallas de abajo quedan montadas (ocultas) para volver
// al mismo lugar al pulsar Atrás.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, StatusBar, StyleSheet, View } from 'react-native';
import { fetchAlert, PanelAlert } from './api/alerts';
import AlertDialog from './components/AlertDialog';
import { Logo, Spinner } from './components/ui';
import { loadStorage } from './lib/storage';
import { Nav, NavContext, Route } from './nav';
import Actor from './screens/Actor';
import Detail from './screens/Detail';
import Grid from './screens/Grid';
import Login from './screens/Login';
import Main from './screens/Main';
import Player from './screens/Player';
import { getState, loadCatalog, loadCloud, restoreSession } from './state';
import { C } from './theme';

function Screen({ route, active }: { route: Route; active: boolean }) {
  switch (route.name) {
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

export default function App() {
  const [stack, setStack] = useState<Route[] | null>(null);

  useEffect(() => {
    loadStorage().then(() => setStack([restoreSession() ? { name: 'main' } : { name: 'login' }]));
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
        fetchAlert(ses).then(a => a && setAlert(a)).catch(() => {});
      }
    } else if (top === 'login') {
      alertDone.current = false;
      setAlert(null);
    }
  }, [top]);

  // al volver a la app: Continuar viendo y Mi lista otra vez desde el panel (pudo verse en otra app)
  useEffect(() => {
    let last = Date.now();
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active' || !getState().session || Date.now() - last < 60000) return;
      last = Date.now();
      loadCloud();
    });
    return () => sub.remove();
  }, []);

  const nav: Nav = useMemo(
    () => ({
      push: r => setStack(s => [...(s || []), r]),
      pop: () => setStack(s => (s && s.length > 1 ? s.slice(0, -1) : s)),
      reset: r => setStack([r]),
    }),
    [],
  );

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
    return (
      <View style={s.root}>
        <Logo size={200} />
        <Spinner />
      </View>
    );
  }

  return (
    <NavContext.Provider value={nav}>
      <StatusBar hidden />
      <View style={s.app}>
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
      <AlertDialog alert={alert} onClose={() => setAlert(null)} />
    </NavContext.Provider>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  app: { flex: 1, backgroundColor: C.bg },
  hidden: { display: 'none' },
});
