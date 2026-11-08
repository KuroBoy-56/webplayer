// Imagen con respaldo: si una dirección no carga, prueba la siguiente (carátula del panel → img.php → original).
// Además del error, un tiempo límite: en Vega una imagen que no existe a veces no avisa el error y la tarjeta quedaba
// en blanco para siempre. La copia del panel (la primera) tiene 3 s (si existe es un archivo chico servido sin PHP);
// las demás, 6 s. Qué dirección cargó cada imagen se recuerda mientras la app está abierta (src/lib/imagememory.ts).
import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, ImageResizeMode, ImageStyle, Platform, StyleProp, View } from 'react-native';
import { firstSource, sourceFailed, sourceLoaded } from '../lib/imagememory';

export const ChainImage = memo(function ChainImage({ sources, style, resizeMode, blurRadius }: { sources: string[]; style: StyleProp<ImageStyle>; resizeMode?: ImageResizeMode; blurRadius?: number }) {
  const sig = sources.join('\n');
  const [i, setI] = useState(() => firstSource(sources));
  const loaded = useRef(false);
  useEffect(() => setI(firstSource(sources)), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const uri = sources[i];
  useEffect(() => {
    loaded.current = false;
    if (!uri || i >= sources.length - 1) return;
    const id = setTimeout(() => !loaded.current && setI(n => (n === i ? n + 1 : n)), i === 0 ? 3000 : 6000);
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
      onLoad={() => {
        loaded.current = true;
        sourceLoaded(sources, uri);
      }}
      onError={() => {
        sourceFailed(uri);
        setI(n => (n === i ? n + 1 : n));
      }}
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
