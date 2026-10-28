// Aviso del panel al abrir la app (Alertas / admin_alertas.php → api/alerta.php?format=json):
// bienvenida (texto general + imagen) o vencimiento (texto de 3, 2, 1 o 0 días).
import { json } from '../lib/http';
import { APP_ID, tenantCode } from '../lib/tenant';
// panel() agrega &lang=: título y botón del aviso en el idioma de la app (el mensaje queda como lo
// escribió el distribuidor)
import { panel, panelApiBase, Session } from './panel';
import { t } from '../lib/i18n';

// images: todas las imágenes de Alertas del panel, en orden (la primera es image); cambian cada interval s
export type PanelAlert = {
  expiry: boolean;
  title: string;
  message: string;
  image: string;
  images: string[];
  interval: number;
  button: string;
};

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
  // todas las imágenes del registro del panel (Alertas), en orden; sin la lista (panel anterior), la de siempre
  let images: string[] =
    j.type === 'welcome' && Array.isArray(j.images)
      ? j.images.map((u: any) => String(u || '').trim()).filter((u: string) => /^https?:\/\//i.test(u))
      : [];
  if (!images.length && image) images = [image];
  const interval = Number(j.interval) >= 1 ? Math.floor(Number(j.interval)) : 3;
  return {
    expiry: j.type === 'expiry',
    title: String(j.title || ''),
    message: String(j.message || ''),
    image: images[0] || '',
    images,
    interval,
    button: String(j.button || t('ENTENDIDO')),
  };
}
