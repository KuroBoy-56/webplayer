declare module 'react-native-web';

// src/player/shaka-env.ts (solo Vega; en Samsung tools/build-tizen.js pone web/shims/shaka.ts y Shaka no entra en app.js):
// sus dependencias no se instalan aquí, basta con que el chequeo de tipos las conozca
declare module '@xmldom/xmldom' {
  export const DOMParser: any;
  export const XMLSerializer: any;
}
declare module 'base-64' {
  export function encode(s: string): string;
  export function decode(s: string): string;
}
