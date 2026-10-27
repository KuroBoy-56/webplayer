// Imagen con respaldo: si una dirección no carga, prueba la siguiente (carátula del panel → img.php → original)
import React, { memo, useEffect, useState } from 'react';
import { Image, ImageResizeMode, ImageStyle, StyleProp } from 'react-native';

export const ChainImage = memo(function ChainImage({ sources, style, resizeMode, blurRadius }: { sources: string[]; style: StyleProp<ImageStyle>; resizeMode?: ImageResizeMode; blurRadius?: number }) {
  const [i, setI] = useState(0);
  const sig = sources.join('\n');
  useEffect(() => setI(0), [sig]);
  const uri = sources[i];
  if (!uri) return null;
  return <Image source={{ uri }} style={style} resizeMode={resizeMode} blurRadius={blurRadius} onError={() => setI(n => n + 1)} />;
});
