// Aviso del panel al abrir la app (Alertas / admin_alertas.php → api/alerta.php?format=json):
// bienvenida (texto general + imagen) o vencimiento (texto de 3, 2, 1 o 0 días).
import { json } from '../lib/http';
import { APP_ID, tenantCode } from '../lib/tenant';
import { panel, panelApiBase, Session } from './panel';

export type PanelAlert = { expiry: boolean; title: string; message: string; image: string; button: string };

export async function fetchAlert(s: Session): Promise<PanelAlert | null> {
  const q = [
    ['format', 'json'],
    ['user', s.user],
    ['pass', s.pass],
    ['dns', s.base],
    ['title', s.dns || ''],
    // con distribuidor: sus textos (?t=<número>&app=)
    ...(tenantCode() ? [['t', tenantCode()], ['app', APP_ID]] : []),
  ]
    .map(([k, v]) => k + '=' + encodeURIComponent(v))
    .join('&');
  const r = await panel('alerta.php', 'GET', '', '', '?' + q);
  const j = r.ok ? json<any>(r) : null;
  if (!j || (j.type !== 'welcome' && j.type !== 'expiry')) return null;
  const path = String(j.image_path || '');
  let image = '';
  if (j.type === 'welcome') {
    if (/^img\/alertas\/[A-Za-z0-9._-]+$/.test(path)) image = panelApiBase().replace(/api\/$/, '') + path;
    else if (/^https?:\/\//i.test(String(j.image || ''))) image = String(j.image);
  }
  return {
    expiry: j.type === 'expiry',
    title: String(j.title || ''),
    message: String(j.message || ''),
    image,
    button: String(j.button || 'ENTENDIDO'),
  };
}
