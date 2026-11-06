// Listas de filas de alto fijo que se recorren con el control (canales, carpetas, menú de canales de pantalla grande).
// Como Inicio y el ejemplo de Amazon (vega-scrolling-sample): la lista no se desplaza sola (scrollEnabled false) y la app
// la mueve al cambiar el foco, sin animación y solo si hace falta (una fila de margen arriba y abajo). Con el
// desplazamiento del sistema más el de la lista, cada paso movía la lista dos veces y el canal de la miniatura se
// entrecortaba al recorrerla rápido.
import { useCallback, useRef } from 'react';
import type { FlatList, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** desplazamiento para que la fila i se vea con una fila de margen; y si ya se ve (count: filas de la lista) */
export function scrollFor(i: number, rowH: number, y: number, view: number, count = Infinity): number {
  const top = i * rowH;
  let to = y;
  if (top - rowH < y) to = top - rowH;
  else if (view > 0 && top + 2 * rowH > y + view) to = top + 2 * rowH - view;
  return Math.max(0, Math.min(to, count * rowH - view));
}

export function useListScroll<T>(rowH: number, count: number) {
  const ref = useRef<FlatList<T>>(null);
  const y = useRef(0);
  const view = useRef(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    view.current = e.nativeEvent.layout.height;
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    y.current = e.nativeEvent.contentOffset.y;
  }, []);
  // la fila i recibió el foco
  const show = useCallback(
    (i: number) => {
      if (!view.current) return;
      const to = scrollFor(i, rowH, y.current, view.current, count);
      if (to === y.current) return;
      y.current = to;
      ref.current?.scrollToOffset({ offset: to, animated: false });
    },
    [rowH, count],
  );
  // la fila i a esa altura de la lista (0.4: un poco arriba de la mitad), p. ej. al volver de pantalla grande
  const place = useCallback(
    (i: number, at = 0.4) => {
      const to = Math.max(0, Math.min(i * rowH - (view.current - rowH) * at, count * rowH - view.current));
      y.current = to;
      ref.current?.scrollToOffset({ offset: to, animated: false });
    },
    [rowH, count],
  );
  // la lista volvió a empezar (otra carpeta) o se abrió en otra fila (initialScrollIndex): desde ahí
  const reset = useCallback((to = 0) => {
    y.current = to;
  }, []);
  return { ref, onLayout, onScroll, show, place, reset };
}
