// Buscar en películas, series y canales.
// El recuadro abre el teclado de la app (como Usuario y Contraseña en Login): un campo de texto del sistema en Vega se
// queda con las flechas y al bajar abría el teclado en vez de pasar a los resultados.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import KeyboardModal from '../components/KeyboardModal';
import { Focusable } from '../components/ui';
import { catalog, Item } from '../data/catalog';
import { useAppState } from '../state';
import { alpha, C, px, SIDE, themed } from '../theme';
import { t } from '../lib/i18n';
import { ItemGrid } from './Grid';

export default function Search({ active }: { active: boolean }) {
  const st = useAppState();
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  // al cerrar el teclado (Listo o Atrás) con resultados, el foco baja a la primera carátula (antes se quedaba en el
  // recuadro de arriba y al bajar se volvía a abrir el teclado)
  const [focusRev, setFocusRev] = useState(0);

  // los resultados se arman mientras se escribe (un momento después de la última tecla, como Android)
  useEffect(() => {
    const id = setTimeout(() => setItems(q.trim().length >= 2 ? catalog.search(q) : []), typing ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, st.catalogRev, st.loaded.live, typing]);

  const close = (v: string) => {
    setQ(v);
    setTyping(false);
    if (v.trim().length >= 2) setFocusRev(n => n + 1);
  };

  return (
    <View style={s.root}>
      <Focusable onPress={() => setTyping(true)} style={f => [s.input, f && s.inputF]}>
        <Text style={[s.text, !q && s.ph]} numberOfLines={1}>
          {q || t('Títulos, series, canales…')}
        </Text>
      </Focusable>
      {q.trim().length >= 2 && !items.length ? <Text style={s.none}>{t('No hay resultados para «{q}»', { q: q.trim() })}</Text> : null}
      <ItemGrid items={items} channels active={active} focusFirst={typing ? 0 : focusRev} />
      {typing ? (
        <KeyboardModal
          title={t('Buscar')}
          value={q}
          onChange={setQ}
          // Atrás también se queda con lo escrito (antes lo borraba y no se veía nada)
          onClose={() => close(q)}
          onDone={close}
        />
      ) : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: px(130) },
    // texto centrado en el alto del recuadro
    input: { marginHorizontal: SIDE, height: px(84), justifyContent: 'center', alignItems: 'center', backgroundColor: C.card, borderRadius: px(8), borderWidth: px(3), borderColor: 'transparent', paddingHorizontal: px(28), marginBottom: px(20) },
    inputF: { borderColor: C.text, backgroundColor: alpha(C.text, 0.12) },
    // centrado en el recuadro a lo alto y a lo ancho (sin el relleno de la fuente, que lo bajaba)
    text: { color: C.text, fontSize: px(34), lineHeight: px(44), textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
    ph: { color: C.dim },
    none: { color: C.sub, fontSize: px(28), marginLeft: SIDE },
  }),
);
