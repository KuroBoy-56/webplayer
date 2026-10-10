// WebVTT del panel -> lista de textos con su inicio y fin (segundos).
export type Cue = { s: number; e: number; text: string };

function time(t: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(t.trim());
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) + Number(m[4].padEnd(3, '0')) / 1000;
}

export function parseVtt(body: string): Cue[] {
  const out: Cue[] = [];
  const blocks = body.replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const s = time(a);
    const e = time((z || '').trim().split(/\s+/)[0] || '');
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    // sin etiquetas (<i>, <c.color>, {\an8}…)
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (text) out.push({ s, e, text });
  }
  return out.sort((x, y) => x.s - y.s);
}

// texto que corresponde al segundo t (búsqueda binaria; puede haber dos a la vez)
export function cueAt(cues: Cue[], t: number): string {
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].s <= t) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: string[] = [];
  for (let i = last; i >= 0 && i > last - 4; i--) if (cues[i].e > t) out.unshift(cues[i].text);
  return out.join('\n');
}
