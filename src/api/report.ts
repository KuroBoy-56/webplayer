// Errores de la app al panel (api/report.php, cifrado igual que login.php): el dueño los ve en
// «Errores de las apps» con el equipo, la hora, la línea y el detalle. Nunca se manda la contraseña
// de la línea (el panel además tapa usuario/contraseña de las direcciones).
import { Platform } from 'react-native';
import { APP_VERSION } from '../version';
import { osVersion } from '../lib/osversion';
import { hasMasterKey, panelEncrypt } from '../lib/aes';
import { formBody } from '../lib/http';
import { APP_ID, tenantCode } from '../lib/tenant';
import { panel } from './panel';

export type ErrorKind = 'crash' | 'error' | 'playback' | 'network' | 'panel' | 'warning';

// la versión real de la app (antes iba fija en 1.0.0 y los reportes no decían qué versión fallaba)
const VERSION = APP_VERSION;
const recent: Record<string, number> = {};
let ctx: () => { device: string; user: string; server: string } = () => ({ device: '', user: '', server: '' });

export function bindReportContext(fn: typeof ctx): void {
  ctx = fn;
}

// versión del sistema; si el equipo no la da con un nombre conocido, lo que trae Platform.constants (para saber dónde está)
function osText(): string {
  const v = osVersion();
  if (v) return v;
  try {
    // sin lo que ya se sabe (el panel corta el campo: antes quedaba afuera justo la versión)
    const { isTesting, reactNativeVersion, uiMode, ...rest } = (Platform as any).constants || {};
    return JSON.stringify(rest).slice(0, 150);
  } catch {
    return '';
  }
}

export function reportError(kind: ErrorKind, message: string, detail = '', screen = ''): void {
  if (!message || !hasMasterKey()) return;
  // el mismo error seguido no se manda más de una vez por minuto
  const key = kind + '|' + message;
  const now = Date.now();
  if ((recent[key] || 0) > now - 60000) return;
  recent[key] = now;
  let c = { device: '', user: '', server: '' };
  try {
    c = ctx();
  } catch {}
  const body: Record<string, string> = {
    app: APP_ID,
    version: VERSION,
    kind,
    message: message.slice(0, 400),
    detail: detail.slice(0, 8000),
    screen,
    device: c.device,
    model: 'Fire TV Vega OS',
    os: 'Vega OS ' + osText(),
    user: c.user,
    server: c.server,
  };
  const t = tenantCode();
  if (t) body.tenant = t;
  const data = panelEncrypt(JSON.stringify(body));
  if (!data) return;
  panel('report.php', 'POST', formBody({ data }), 'application/x-www-form-urlencoded').catch(() => {});
}

// errores de JavaScript que no se atraparon. 2.6.4: ya no cierran la app (antes se llamaba enseguida al manejador de
// siempre, que la cerraba antes de que saliera el aviso al panel: «me bota de la aplicación» sin rastro). Ahora el
// error va al panel con su detalle y la app vuelve a la pantalla anterior con un aviso (setRecover). Si se repiten
// muchos seguidos (la app ya no puede seguir), se deja cerrar como antes.
let recover: ((msg: string) => void) | null = null;
const fatals: number[] = [];

export function setRecover(fn: (msg: string) => void): void {
  recover = fn;
}

export function installCrashReporter(): void {
  const g: any = globalThis as any;
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.getGlobalHandler !== 'function') return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e: any, fatal?: boolean) => {
    const msg = String((e && e.message) || e || 'Error');
    try {
      reportError(fatal ? 'crash' : 'error', msg, String((e && e.stack) || ''), 'JS');
    } catch {}
    try {
      require('../lib/blackbox').bbStep('error de JavaScript: ' + msg, true);
    } catch {}
    if (!fatal) return;
    const now = Date.now();
    while (fatals.length && fatals[0] < now - 30000) fatals.shift();
    fatals.push(now);
    if (recover && fatals.length <= 3) {
      try {
        recover(msg);
        return;
      } catch {
        // no se pudo volver: como antes
      }
    }
    if (prev) prev(e, fatal);
  });
}
