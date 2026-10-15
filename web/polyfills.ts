// Lo mínimo que les falta a los televisores Samsung más viejos que soporta la app (Tizen 4.0-5.5, Chromium 56-69):
// se carga antes que todo lo demás (web/index.tsx). En Tizen 6 o más nuevos no hace nada.
/* eslint-disable no-extend-native */
const w: any = typeof window !== 'undefined' ? window : {};

if (typeof w.globalThis === 'undefined') w.globalThis = w;

if (!String.prototype.padStart) {
  const pad = (s: string, n: number, f: string) => {
    const fill = f === undefined ? ' ' : String(f);
    if (s.length >= n || !fill) return '';
    let p = '';
    while (p.length < n - s.length) p += fill;
    return p.slice(0, n - s.length);
  };
  String.prototype.padStart = function (n: number, f?: string) {
    return pad(String(this), n, f as string) + String(this);
  };
  String.prototype.padEnd = function (n: number, f?: string) {
    return String(this) + pad(String(this), n, f as string);
  };
}

if (!Object.entries) (Object as any).entries = (o: any) => Object.keys(o).map(k => [k, o[k]]);
if (!Object.values) (Object as any).values = (o: any) => Object.keys(o).map(k => o[k]);

if (typeof Promise !== 'undefined' && !(Promise.prototype as any).finally) {
  (Promise.prototype as any).finally = function (f: () => void) {
    return this.then(
      (v: any) => Promise.resolve(f()).then(() => v),
      (e: any) => Promise.resolve(f()).then(() => {
        throw e;
      }),
    );
  };
}

// AbortController (Chromium 66+): sin él los tiempos de espera de src/lib/http.ts nunca cortaban un servidor
// que no responde. El fetch viejo no conoce signal: se corta aquí (la respuesta tardía se descarta).
if (typeof w.AbortController === 'undefined') {
  class Signal {
    aborted = false;
    private ls: (() => void)[] = [];
    addEventListener(_t: string, l: () => void) {
      this.ls.push(l);
    }
    removeEventListener(_t: string, l: () => void) {
      this.ls = this.ls.filter(x => x !== l);
    }
    fire() {
      if (this.aborted) return;
      this.aborted = true;
      for (const l of this.ls.slice()) l();
    }
  }
  w.AbortController = class {
    signal = new Signal();
    abort() {
      this.signal.fire();
    }
  };
  const orig = w.fetch;
  if (orig) {
    w.fetch = (input: any, init?: any) => {
      const sig: Signal | undefined = init?.signal;
      // con el this de window: un fetch suelto da 'Illegal invocation'
      const p = orig.call(w, input, init);
      if (!sig) return p;
      return new Promise((resolve, reject) => {
        const stop = () => reject(new Error('AbortError'));
        if (sig.aborted) return stop();
        sig.addEventListener('abort', stop);
        p.then(resolve, reject);
      });
    };
  }
}

export {};
