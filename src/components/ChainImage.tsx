// Imagen con respaldo: si una dirección no carga, prueba la siguiente (carátula del panel → img.php → original).
// Además del error, un tiempo límite: en Vega una imagen que no existe a veces no avisa el error y la tarjeta quedaba
// en blanco para siempre; si en 6 s no cargó, se pasa a la siguiente dirección.
import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, ImageResizeMode, ImageStyle, Platform, StyleProp, View } from 'react-native';

export const ChainImage = memo(function ChainImage({ sources, style, resizeMode, blurRadius }: { sources: string[]; style: StyleProp<ImageStyle>; resizeMode?: ImageResizeMode; blurRadius?: number }) {
  const [i, setI] = useState(0);
  const sig = sources.join('\n');
  const loaded = useRef(false);
  useEffect(() => setI(0), [sig]);
  const uri = sources[i];
  useEffect(() => {
    loaded.current = false;
    if (!uri || i >= sources.length - 1) return;
    const id = setTimeout(() => !loaded.current && setI(n => (n === i ? n + 1 : n)), 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, i]);
  if (!uri) return null;
  const img = (st: StyleProp<ImageStyle>) => (
    <Image
      source={{ uri }}
      style={st}
      resizeMode={resizeMode}
      blurRadius={blurRadius}
      onLoad={() => (loaded.current = true)}
      onError={() => setI(n => n + 1)}
    />
  );
  // televisores con la app web: el desenfoque CSS deja los bordes de la imagen transparentes (un marco oscuro
  // alrededor); la imagen va más grande que su lugar y se recorta, así el borde borroso queda afuera
  if (blurRadius && Platform.OS === 'web') {
    const e = -blurRadius * 3;
    return <View style={[style as any, { overflow: 'hidden' }]}>{img({ position: 'absolute', left: e, top: e, right: e, bottom: e })}</View>;
  }
  return img(style);
});
