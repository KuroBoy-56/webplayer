// Pantalla falsa del panel para equipos nuevos (Pantalla Falsa, solo el dueño): calculadora que
// funciona de verdad, carrusel o imagen. Vega OS no tiene navegador ni reproductor libre fuera del
// reproductor de la app: «video» y «web» se muestran como la calculadora. El código del panel + «=»
// abre el inicio de sesión. Abajo, pequeño, el ID del equipo para que lo registren.
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { FakeScreen as Fake } from '../api/panel';
import { px, themed } from '../theme';
import { Focusable } from './ui';

const KEYS = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

// + - × ÷ y paréntesis, sin eval
function calc(src: string): string {
  const t = src.match(/\d+(\.\d+)?|[()+\-×÷]/g) || [];
  let p = 0;
  const num = (): number => {
    const x = t[p++];
    if (x === '(') {
      const v = add();
      p++;
      return v;
    }
    if (x === '-') return -num();
    if (x === undefined || isNaN(+x)) throw new Error('n');
    return +x;
  };
  const mul = (): number => {
    let v = num();
    while (t[p] === '×' || t[p] === '÷') {
      const o = t[p++];
      const r = num();
      v = o === '×' ? v * r : v / r;
    }
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (t[p] === '+' || t[p] === '-') {
      const o = t[p++];
      const r = mul();
      v = o === '+' ? v + r : v - r;
    }
    return v;
  };
  try {
    if (!t.length) return '';
    const v = add();
    if (p !== t.length || !isFinite(v)) return 'Error';
    return String(Math.round(v * 1e10) / 1e10);
  } catch {
    return 'Error';
  }
}

function Calculator({ unlock, onUnlock }: { unlock: string; onUnlock: () => void }) {
  const [d, setD] = useState('');
  const press = (k: string) => {
    if (k === 'C') return setD('');
    if (k === '=') {
      if (unlock && d === unlock) {
        setD('');
        onUnlock();
        return;
      }
      return setD(calc(d));
    }
    setD(v => (v === 'Error' ? '' : v) + k);
  };
  return (
    <View style={s.calc}>
      <Text style={s.display} numberOfLines={1}>
        {d || '0'}
      </Text>
      {KEYS.map((row, r) => (
        <View key={r} style={s.row}>
          {row.map(k => (
            <Focusable key={k} onPress={() => press(k)} preferred={k === '7'} style={(f: boolean) => [s.key, k === '0' && s.wide, keyColor(k), f && s.keyFocus]}>
              <Text style={s.keyText}>{k}</Text>
            </Focusable>
          ))}
        </View>
      ))}
    </View>
  );
}

function keyColor(k: string) {
  if (k === 'C') return { backgroundColor: '#ef4444' };
  if ('÷×-+='.includes(k)) return { backgroundColor: '#f59e0b' };
  return { backgroundColor: '#4b5563' };
}

function Carousel({ images, interval }: { images: string[]; interval: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setI(x => (x + 1) % images.length), interval * 1000);
    return () => clearInterval(t);
  }, [images, interval]);
  return <Image source={{ uri: images[i] }} style={s.full} resizeMode="contain" />;
}

export default function FakeScreen({ screen, device, onUnlock }: { screen: Fake; device: string; onUnlock: () => void }) {
  let body: React.ReactNode;
  if (screen.type === 'carrusel' && screen.images.length) body = <Carousel images={screen.images} interval={screen.interval} />;
  else if (screen.type === 'image' && screen.url) body = <Image source={{ uri: screen.url }} style={s.full} resizeMode="contain" />;
  else body = <Calculator unlock={screen.unlock} onUnlock={onUnlock} />;
  return (
    <View style={s.root}>
      {body}
      <Text style={s.id}>ID {device}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
  calc: { width: px(560), backgroundColor: '#1f2937', borderRadius: px(24), padding: px(26) },
  display: { color: '#fff', fontSize: px(58), textAlign: 'right', backgroundColor: '#374151', borderRadius: px(12), paddingHorizontal: px(18), paddingVertical: px(14), marginBottom: px(16) },
  row: { flexDirection: 'row', marginBottom: px(12) },
  key: { flex: 1, height: px(78), marginHorizontal: px(6), borderRadius: px(12), alignItems: 'center', justifyContent: 'center', borderWidth: px(3), borderColor: 'transparent' },
  wide: { flex: 2.15 },
  keyFocus: { borderColor: '#fff', transform: [{ scale: 1.06 }] },
  keyText: { color: '#fff', fontSize: px(34), fontWeight: 'bold' },
  id: { position: 'absolute', bottom: px(10), color: 'rgba(255,255,255,0.35)', fontSize: px(16) },
}));
