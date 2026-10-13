// Botón «DNS» (como Android e iOS): DNS seguro elegido por el usuario para saltar bloqueos del proveedor de
// internet. El televisor no deja cambiar su DNS, así que la app resuelve el nombre del servidor IPTV con
// DNS sobre HTTPS y, si el DNS de la red no lo encuentra, se conecta a esa IP. Solo para http (https
// necesita el nombre para el certificado). «Automático» = el DNS de la red, sin cambios.
import { pref, setPref } from './storage';

export type DnsOption = { key: string; label: string; note: string; endpoint: string };

export const DNS_OPTIONS: DnsOption[] = [
  { key: 'auto', label: 'Automático', note: 'El DNS de tu red (recomendado)', endpoint: '' },
  { key: 'cloudflare', label: 'Cloudflare', note: 'Rápido y privado', endpoint: 'https://cloudflare-dns.com/dns-query' },
  { key: 'google', label: 'Google', note: 'Estable en todo el mundo', endpoint: 'https://dns.google/dns-query' },
  { key: 'quad9', label: 'Quad9', note: 'Bloquea sitios peligrosos', endpoint: 'https://dns.quad9.net/dns-query' },
  { key: 'adguard', label: 'AdGuard', note: 'Sin rastreo ni anuncios', endpoint: 'https://dns.adguard-dns.com/dns-query' },
  { key: 'nextdns', label: 'NextDNS', note: 'Anti-bloqueo geográfico', endpoint: 'https://dns.nextdns.io/dns-query' },
  { key: 'opendns', label: 'OpenDNS', note: 'Filtro de Cisco', endpoint: 'https://doh.opendns.com/dns-query' },
];

const cache: Record<string, { ip: string; until: number }> = {};

export function dnsChoice(): DnsOption {
  const k = pref('dns', 'auto');
  return DNS_OPTIONS.find(o => o.key === k) || DNS_OPTIONS[0];
}

export function setDnsChoice(key: string): void {
  setPref('dns', key);
  for (const k of Object.keys(cache)) delete cache[k];
}

// pregunta DNS (RFC 8484, tipo A) y primera respuesta A
export function dnsQuery(host: string): Uint8Array {
  const out = [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const label of host.split('.')) {
    const b = Array.from(new TextEncoder().encode(label)).slice(0, 63);
    out.push(b.length, ...b);
  }
  out.push(0, 0, 1, 0, 1);
  return new Uint8Array(out);
}

export function firstA(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  const qd = (b[4] << 8) | b[5];
  const an = (b[6] << 8) | b[7];
  let i = 12;
  const skipName = () => {
    while (i < b.length) {
      const l = b[i];
      if (l === 0) return void i++;
      if ((l & 0xc0) === 0xc0) return void (i += 2);
      i += l + 1;
    }
  };
  for (let q = 0; q < qd; q++) {
    skipName();
    i += 4;
  }
  for (let a = 0; a < an; a++) {
    skipName();
    if (i + 10 > b.length) return null;
    const type = (b[i] << 8) | b[i + 1];
    const len = (b[i + 8] << 8) | b[i + 9];
    i += 10;
    if (type === 1 && len === 4) return `${b[i]}.${b[i + 1]}.${b[i + 2]}.${b[i + 3]}`;
    i += len;
  }
  return null;
}

async function resolve(host: string): Promise<string | null> {
  const opt = dnsChoice();
  if (!opt.endpoint || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  const k = opt.key + '|' + host.toLowerCase();
  const c = cache[k];
  if (c && c.until > Date.now()) return c.ip;
  let q = btoa(String.fromCharCode(...Array.from(dnsQuery(host))));
  q = q.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    const r = await fetch(opt.endpoint + '?dns=' + q, { headers: { Accept: 'application/dns-message' } });
    if (r.status !== 200) return null;
    const ip = firstA(new Uint8Array(await r.arrayBuffer()));
    if (ip) cache[k] = { ip, until: Date.now() + 600000 };
    return ip;
  } catch {
    return null;
  }
}

// la misma dirección (http) con la IP que da el DNS elegido, o null si no aplica
export async function viaDns(url: string): Promise<string | null> {
  const m = /^http:\/\/([^/:?#]+)(.*)$/i.exec(url);
  if (!m) return null;
  const ip = await resolve(m[1]);
  return ip ? 'http://' + ip + m[2] : null;
}
