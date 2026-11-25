// Imagen con respaldo: si una dirección no carga, prueba la siguiente (carátula del panel → img.php → original).
// Además del error, un tiempo límite: en Vega una imagen que no existe a veces no avisa el error y la tarjeta quedaba
// en blanco para siempre. La copia del panel (la primera) tiene 3 s (si existe es un archivo chico servido sin PHP);
// las demás, 6 s. Qué dirección cargó cada imagen se recuerda mientras la app está abierta (src/lib/imagememory.ts).
import React, { createContext, memo, useContext, useEffect, useRef, useState } from 'react';
import { Image, ImageResizeMode, ImageStyle, StyleProp, View } from 'react-native';
import { firstSource, sourceFailed, sourceLoaded } from '../lib/imagememory';

// 2.8.0: true en las pantallas que quedan debajo del reproductor (App.tsx). Ahí no se dibuja ninguna carátula ni fondo:
// Inicio y la ficha seguían montadas con decenas de imágenes (fondos en Full HD) ocupando la memoria que necesita el
// video (Vega cierra la app al pasar de 420 MB). Al cerrar el reproductor vuelven a dibujarse
export const ImagesOff = createContext(false);
export const useImagesOff = () => useContext(ImagesOff);

export const ChainImage = memo(function ChainImage({ sources, style, resizeMode, blurRadius }: { sources: string[]; style: StyleProp<ImageStyle>; resizeMode?: ImageResizeMode; blurRadius?: number }) {
  const sig = sources.join('\n');
  const [i, setI] = useState(() => firstSource(sources));
  const loaded = useRef(false);
  useEffect(() => setI(firstSource(sources)), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const uri = sources[i];
  const off = useImagesOff();
  useEffect(() => {
    loaded.current = false;
    // (sin dibujarse no se espera ninguna: no se pasa a otra dirección por no cargar)
    if (off || !uri || i >= sources.length - 1) return;
    const id = setTimeout(() => !loaded.current && setI(n => (n === i ? n + 1 : n)), i === 0 ? 3000 : 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, i, off]);
  if (!uri) return null;
  if (off) return <View style={style} />;
  return (
    <Image
      source={{ uri }}
      style={style}
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
});
