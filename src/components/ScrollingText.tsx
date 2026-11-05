// Texto largo en un recuadro que ocupa como mucho el espacio libre: si no cabe, sube solo hasta que se ve la última
// línea, espera y vuelve a empezar desde arriba. Nunca pasa por encima de lo que está debajo (guía de TV en vivo: la
// descripción tapaba «Agregar a favoritos» y lo que sigue). En la tele (web) se mueve con CSS; en Vega con Animated.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

const PX_PER_S = 22;
const WAIT_TOP = 3000;
const WAIT_END = 2500;

// line: alto de una línea (el recuadro se corta en líneas enteras, sin letras partidas arriba o abajo)
export function ScrollingText({ text, style, box, line }: { text: string; style: StyleProp<TextStyle>; box?: StyleProp<ViewStyle>; line?: number }) {
  const [outer, setOuter] = useState(0);
  const [inner, setInner] = useState(0);
  const fits = inner > 0 && inner <= outer + 1;
  // lo que se ve: el espacio libre, en líneas enteras si el texto no cabe
  const clip = !outer || fits || !line ? outer : Math.max(line, Math.floor(outer / line) * line);
  const d = clip > 0 ? Math.max(0, Math.round(inner - clip)) : 0;
  const move = (d / PX_PER_S) * 1000;
  const total = WAIT_TOP + move + WAIT_END;
  const body = <Text style={style}>{text}</Text>;
  return (
    <View style={[s.box, box]} onLayout={e => setOuter(e.nativeEvent.layout.height)}>
      <View style={!fits && clip > 0 ? { height: clip, overflow: 'hidden' } : null}>
        {Platform.OS === 'web' ? (
          <WebMover key={text + d} d={d} total={total} move={move} onHeight={setInner}>
            {body}
          </WebMover>
        ) : (
          <NativeMover key={text + d} d={d} move={move} onHeight={setInner}>
            {body}
          </NativeMover>
        )}
      </View>
    </View>
  );
}

type Mover = { d: number; move: number; onHeight: (h: number) => void; children: React.ReactNode };

function WebMover({ d, total, move, onHeight, children }: Mover & { total: number }) {
  // animación CSS (StyleSheet: como estilo en línea react-native-web la descarta), una por distancia
  const anim = useMemo(() => {
    if (d < 4) return null;
    const a = Math.round((WAIT_TOP / total) * 100);
    const b = Math.round(((WAIT_TOP + move) / total) * 100);
    return StyleSheet.create({
      go: {
        animationKeyframes: [{ '0%': { transform: 'translateY(0px)' }, [a + '%']: { transform: 'translateY(0px)' }, [b + '%']: { transform: 'translateY(-' + d + 'px)' }, '100%': { transform: 'translateY(-' + d + 'px)' } }],
        animationDuration: Math.round(total) + 'ms', animationIterationCount: 'infinite', animationTimingFunction: 'linear',
      } as any,
    }).go;
  }, [d, total, move]);
  return <View style={anim} onLayout={e => onHeight(e.nativeEvent.layout.height)}>{children}</View>;
}

function NativeMover({ d, move, onHeight, children }: Mover) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (d < 4) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(WAIT_TOP),
        Animated.timing(y, { toValue: -d, duration: move, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(WAIT_END),
        Animated.timing(y, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [d, move, y]);
  return (
    <Animated.View style={{ transform: [{ translateY: y }] }} onLayout={e => onHeight(e.nativeEvent.layout.height)}>
      {children}
    </Animated.View>
  );
}

// del alto de su texto como mucho; si no cabe, el espacio que queda (lo demás no se encoge: flexShrink 0)
const s = StyleSheet.create({
  box: { flexGrow: 0, flexShrink: 1, minHeight: 0, overflow: 'hidden' },
});
