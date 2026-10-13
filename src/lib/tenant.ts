// Distribuidor (número de 6 dígitos del panel): elección guardada, marca (nombre, logo y
// colores) y funciones activas. "Omitir" = la app de siempre, sin enviar nada nuevo al panel.
import { useSyncExternalStore } from 'react';
import { Palette, setPalette, validPalette } from '../theme';
import { read, readJson, remove, write, writeJson } from './storage';
import { str } from './util';

export const APP_ID = 'vega';
export const APP_NAME = 'MPX Player';
// sin respuesta del panel se sigue con la marca guardada hasta 72 h
export const OFFLINE_GRACE = 72 * 3600;
const PANAMA = -5 * 3600; // America/Panama, UTC-5 sin horario de verano

export type Features = { demo: boolean; alerts: boolean; sports: boolean };

export type Brand = {
  code: string;
  name: string;
  logoUrl: string;
  logoRev: number;
  palette: Palette | null;
  expiresAt: number;
  expiresDate: string;
  features: Features;
  rev: number;
  recheckAfter: number;
  lastOk: number;
};

const ALL: Features = { demo: true, alerts: true, sports: true };

// '' (aún no eligió), 'skip' (Omitir) o 'code'
export function distChoice(): '' | 'skip' | 'code' {
  const c = read('dist_choice');
  if (c === 'skip') return 'skip';
  if (c === 'code' && /^\d{6}$/.test(read('dist_code'))) return 'code';
  return '';
}

// número de distribuidor en uso ('' con Omitir)
export function tenantCode(): string {
  return distChoice() === 'code' ? read('dist_code') : '';
}

// campos que llevan las peticiones al panel cuando hay distribuidor
export function tenantFields(): Record<string, string> {
  const code = tenantCode();
  return code ? { tenant: code, app: APP_ID } : {};
}

// clave de almacenamiento propia de cada distribuidor (con Omitir, la de siempre)
export function scoped(key: string): string {
  const code = tenantCode();
  return code ? key + '@' + code : key;
}

export function brand(): Brand | null {
  if (distChoice() !== 'code') return null;
  const b = readJson<Brand>('dist_brand');
  return b && b.code === tenantCode() ? b : null;
}

export function features(): Features {
  const b = brand();
  return b ? { ...ALL, ...b.features } : ALL;
}

export function brandName(): string {
  return brand()?.name || APP_NAME;
}

// logo del distribuidor ('' = el de la app)
export function brandLogo(): string {
  const b = brand();
  if (!b || !/^https?:\/\//i.test(b.logoUrl)) return '';
  return b.logoUrl + (b.logoUrl.includes('?') ? '&' : '?') + 'v=' + b.logoRev;
}

// respuesta "ok" de tenant_config -> marca
export function parseConfig(j: any, now: number): Brand | null {
  const t = j && typeof j === 'object' ? j.tenant : null;
  if (!t || str(j.status) !== 'ok' || !/^\d{6}$/.test(str(t.code))) return null;
  const f = j.features && typeof j.features === 'object' ? j.features : {};
  const rec = Number(j.recheck_after);
  return {
    code: str(t.code),
    name: str(t.name).trim(),
    logoUrl: str(t.logo_url),
    logoRev: Number(t.logo_rev) || 0,
    palette: validPalette(t.palette),
    expiresAt: Number(t.expires_at) || 0,
    expiresDate: str(t.expires_date),
    features: { demo: f.demo !== false, alerts: f.alerts !== false, sports: f.sports !== false },
    rev: Number(t.rev) || 0,
    recheckAfter: Number.isFinite(rec) && rec >= 60 ? rec : 21600,
    lastOk: now,
  };
}

// fecha de vencimiento DD/MM/AAAA (hora de Panamá)
export function expiryText(b: Brand): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(b.expiresDate);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  if (b.expiresAt <= 0) return '';
  const d = new Date((b.expiresAt + PANAMA) * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
}

// expires_at 0 = sin vencimiento
export function locallyExpired(b: Brand, now: number): boolean {
  return b.expiresAt > 0 && now > b.expiresAt;
}

export function expiredMessage(b: Brand): string {
  const d = expiryText(b);
  return d ? 'Tu distribuidor venció el ' + d + ' (hora de Panamá). Contacta a tu distribuidor.' : TENANT_ERRORS.tenant_expired;
}

export const TENANT_ERRORS: Record<string, string> = {
  tenant_invalid: 'Número de distribuidor no válido',
  tenant_expired: 'El servicio de este distribuidor venció. Contacta a tu distribuidor.',
  tenant_suspended: 'Este distribuidor está suspendido. Contacta a tu distribuidor.',
  app_not_linked: 'Este número de distribuidor no está habilitado para esta aplicación.',
  too_many_attempts: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.',
  app_required: 'Error de la app: no envió su identificador al panel. Avisa a tu distribuidor.',
};

// errores que borran el número guardado
export const TENANT_FATAL = ['tenant_invalid', 'tenant_expired', 'tenant_suspended', 'app_not_linked'];

// ---------- cambios (logo, nombre y colores en pantalla) ----------

let rev = 0;
const listeners = new Set<() => void>();
function changed() {
  rev++;
  listeners.forEach(l => l());
}

export function useBrandRev(): number {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => rev,
  );
}

// aplica los colores guardados; true si cambiaron
export function applyBrand(): boolean {
  const ch = setPalette(brand()?.palette || null);
  changed();
  return ch;
}

export function saveBrand(b: Brand): void {
  write('dist_choice', 'code');
  write('dist_code', b.code);
  writeJson('dist_brand', b);
}

export function markChecked(now: number): void {
  const b = brand();
  if (b) writeJson('dist_brand', { ...b, lastOk: now });
}

export function chooseSkip(): void {
  write('dist_choice', 'skip');
  remove('dist_code');
  remove('dist_brand');
}

// borra el número, la marca y lo guardado para ese distribuidor (sesión aparte: logout())
export function clearTenant(): void {
  const code = tenantCode();
  if (code) for (const k of ['cloud_token2', 'cloud_token2_scope', 'servers', 'tmdb_key', 'panel_pin']) remove(k + '@' + code);
  remove('dist_choice');
  remove('dist_code');
  remove('dist_brand');
}

// el panel respondió con un error del distribuidor durante el uso (progreso, EPG, deportes)
let problem: (code: string) => void = () => {};
export function onTenantProblem(fn: (code: string) => void): void {
  problem = fn;
}
export function reportTenantProblem(code: string): void {
  problem(code);
}
