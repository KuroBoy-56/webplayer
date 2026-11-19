// Fondo de «¿Quién está viendo?» (docs/PERFILES.md del panel, sección 6): lo más destacado de la semana en TMDB (15 a
// 20 títulos, weekHighlights). Profiles.tsx cambia el índice cada 10 s y, al llegar al último, vuelve al primero. La
// imagen nueva aparece con un fundido sobre la anterior recién cuando ya cargó (si no carga, queda la anterior y se
// prueba la siguiente dirección: Full HD del panel → TMDB). Llena la caja que le da Profiles.tsx (arriba a la derecha),
// con los degradados del color del tema encima en sus bordes izquierdo e inferior (Shade).
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Image, Platform, StyleSheet, View } from 'react-native';
import { Highlight } from '../api/tmdb';
import { backdropSources } from '../lib/images';

const WEB = Platform.OS === 'web';
/** cada fondo se ve 10 s */
export const SLIDE_MS = 10000;
const FADE_MS = 700;

export function BackdropSlides({ items, index, onShown }: { items: Highlight[]; index: number; onShown?: (i: number) => void }) {
  // la que ya se ve completa (abajo) y la que entra (arriba, con el fundido)
  const [shown, setShown] = useState(-1);
  const [src, setSrc] = useState(0);
  const it = items[index];
  const sources = it ? backdropSources(it.backdrop) : [];
  const uri = sources[src];
  const key = index + ':' + src;
  // cada imagen que entra tiene su propio fundido que empieza en 0 (si se reutilizaba, la nueva se veía un instante
  // completa antes del fundido)
  const fade = useMemo(() => new Animated.Value(0), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [webOn, setWebOn] = useState('');

  useEffect(() => {
    setSrc(0);
    // la siguiente se pide antes para que entre sin espera
    const next = items[(index + 1) % Math.max(items.length, 1)];
    const nu = next ? backdropSources(next.backdrop)[0] : '';
    if (nu) Image.prefetch(nu).catch(() => {});
  }, [index, items]);

  const loaded = () => {
    const i = index;
    const k = key;
    if (WEB) {
      // en los televisores con la app web, el fundido con CSS (más liviano que Animated), un cuadro después de que la
      // capa se dibujó en 0 (si la imagen ya estaba guardada, carga al instante y el fundido no se veía)
      requestAnimationFrame(() => requestAnimationFrame(() => setWebOn(k)));
      setTimeout(() => { setShown(i); onShown?.(i); }, FADE_MS + 60);
      return;
    }
    Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start(() => {
      setShown(i);
      onShown?.(i);
    });
  };

  const under = shown >= 0 && shown !== index ? items[shown] : undefined;
  const underUri = under ? backdropSources(under.backdrop)[0] : '';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {underUri ? <Image source={{ uri: underUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {uri ? (
        <Animated.View
          key={key}
          style={[StyleSheet.absoluteFill, WEB ? ({ opacity: webOn === key ? 1 : 0, transitionProperty: 'opacity', transitionDuration: FADE_MS + 'ms', transitionTimingFunction: 'ease' } as any) : { opacity: fade }]}
        >
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onLoad={loaded}
            onError={() => setSrc(n => (n + 1 < sources.length ? n + 1 : n))}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
