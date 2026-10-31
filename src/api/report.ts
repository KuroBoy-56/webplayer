// Errores de la app al panel (api/report.php, cifrado igual que login.php): el dueño los ve en
// «Errores de las apps» con el equipo, la hora, la línea y el detalle. Nunca se manda la contraseña
// de la línea (el panel además tapa usuario/contraseña de las direcciones).
import { hasMasterKey, panelEncrypt } from '../lib/aes';
import { formBody } from '../lib/http';
import { tvModel, tvOs } from '../lib/platform';
import { APP_ID, tenantCode } from '../lib/tenant';
import { panel } from './panel';

export type ErrorKind = 'crash' | 'error' | 'playback' | 'network' | 'panel' | 'warning';

const VERSION = '1.0.2';
const recent: Record<string, number> = {};
let ctx: () => { device: string; user: string; server: string } = () => ({ device: '', user: '', server: '' });

export function bindReportContext(fn: typeof ctx): void {
  ctx = fn;
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
    model: tvModel(),
    os: tvOs(),
    user: c.user,
    server: c.server,
  };
  const t = tenantCode();
  if (t) body.tenant = t;
  const data = panelEncrypt(JSON.stringify(body));
  if (!data) return;
  panel('report.php', 'POST', formBody({ data }), 'application/x-www-form-urlencoded').catch(() => {});
}

// errores de JavaScript que no se atraparon (la app se cierra o queda en pantalla de error)
export function installCrashReporter(): void {
  const g: any = globalThis as any;
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.getGlobalHandler !== 'function') return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e: any, fatal?: boolean) => {
    try {
      reportError(fatal ? 'crash' : 'error', String((e && e.message) || e || 'Error'), String((e && e.stack) || ''), 'JS');
    } catch {}
    if (prev) prev(e, fatal);
  });
}
