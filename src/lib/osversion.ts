// Versión de Vega OS del equipo (Platform.constants.keplerOSVersion en React Native 0.83 para Vega). De ella depende qué
// abre el reproductor de Vega: direcciones http en modo directo solo desde Vega OS 2.0 (Amazon).
import { Platform } from 'react-native';

export function osVersion(): string {
  const pc: any = (Platform as any).constants || {};
  // keplerOSVersion (no keplerOSVariant: «Var» también encajaba con «ver» y el aviso decía {"keplerOSVariant":"kepler"})
  const key = Object.keys(pc).find(k => /os.?version/i.test(k)) || Object.keys(pc).find(k => /^(kepler)?os.?ver$/i.test(k));
  const v = key ? pc[key] : (Platform as any).Version;
  if (v && typeof v === 'object') {
    const parts = [v.major, v.minor, v.patch].filter(x => x !== undefined && x !== null);
    return parts.length ? parts.join('.') : JSON.stringify(v).slice(0, 60);
  }
  return v === undefined || v === null ? '' : String(v);
}

// true = Vega OS anterior a 2.0; false si es 2.0 o más nuevo, o si no se sabe
export function osBefore2(v = osVersion()): boolean {
  const m = /(\d+)\.(\d+)/.exec(v);
  return !!m && Number(m[1]) < 2;
}
