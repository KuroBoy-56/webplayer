// Perfiles como Netflix (api/profiles.php del panel; contrato en docs/PERFILES.md del panel). Leer y cambiar los perfiles
// de la línea; el elegido va como «profile» en cada llamada a progress.php (cloud() en api/panel.ts). Con los perfiles
// apagados, una línea DEMO o una sola conexión la app sigue exactamente como antes (todo va al principal).
import { cloud } from './panel';
import { json } from '../lib/http';
import { t } from '../lib/i18n';
import { str } from '../lib/util';

export type Profile = { id: string; name: string; avatar: string; locked: boolean; main: boolean; kids: boolean };
export type ProfilesData = { enabled: boolean; max: number; profiles: Profile[]; canCreate: boolean; avatars: string[]; kidsRules: unknown };
export type ProfileResult = { ok: true; data: ProfilesData } | { ok: false; error: string; code: string };

function parse(j: any): ProfilesData | null {
  if (!j || typeof j !== 'object' || j.success !== true) return null;
  if (j.enabled !== true) return { enabled: false, max: 1, profiles: [], canCreate: false, avatars: [], kidsRules: null };
  const profiles: Profile[] = (Array.isArray(j.profiles) ? j.profiles : [])
    .filter((p: any) => p && str(p.id))
    .map((p: any) => ({ id: str(p.id), name: str(p.name), avatar: str(p.avatar), locked: p.locked === true, main: p.main === true || str(p.id) === 'main', kids: p.kids === true }));
  return {
    enabled: true,
    max: Math.max(1, Number(j.max) || 1),
    profiles,
    canCreate: j.canCreate === true,
    avatars: (Array.isArray(j.avatars) ? j.avatars : []).map(str).filter(Boolean),
    kidsRules: j.kidsRules || null,
  };
}

// null = el panel no contestó (se entra con el principal: la app nunca se queda esperando)
export async function fetchProfiles(max: number): Promise<ProfilesData | null> {
  const r = await cloud('profiles.php', 'GET', max > 0 ? { max: String(max) } : {});
  return parse(json(r));
}

// create, update, delete, pin_set, pin_clear, pin_check, pin_reset (sección 3 del contrato)
export async function profileAction(action: string, fields: Record<string, unknown>): Promise<ProfileResult> {
  const r = await cloud('profiles.php', 'POST', { action, ...fields });
  const j = json<any>(r);
  const data = parse(j);
  if (data) return { ok: true, data };
  if (j && typeof j === 'object' && j.success === false) return { ok: false, error: str(j.error) || t('No se pudo completar'), code: str(j.code) };
  return { ok: false, error: t('No se pudo conectar con el panel. Revisa tu conexión a internet.'), code: 'net' };
}
