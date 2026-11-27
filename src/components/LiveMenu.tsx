// Menú de canales de un partido de «En vivo ahora» (Inicio): el mismo de Deportes. El automático, los canales que lo
// transmiten (en verde los que tiene el cliente), los de la guía y el de los equipos, buscar por el nombre de cada
// equipo y escribir otro nombre. Antes la tarjeta abría solo la primera coincidencia y, si no andaba, no había más.
import React, { useState } from 'react';
import { openItem } from '../actions';
import { Item } from '../data/catalog';
import { LiveCard } from '../data/liveTv';
import { searchChannels } from '../data/sportsPanel';
import { t } from '../lib/i18n';
import { useNav } from '../nav';
import { showNotice } from '../state';
import { InputModal, MenuModal, MenuOpt } from './SportsUi';

export function LiveMenu({ c, onClose }: { c: LiveCard; onClose: () => void }) {
  const nav = useNav();
  const [found, setFound] = useState<{ q: string; list: Item[] } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const play = (ch: Item) => {
    onClose();
    openItem(nav, ch);
  };
  const find = (q: string) => {
    setTyping(null);
    const list = q.trim() ? searchChannels(q) : [];
    if (!list.length) return showNotice(t('No hay canales con «{x}» en tu lista', { x: q }));
    setFound({ q, list });
  };
  if (typing !== null) return <InputModal title={t('Canal, equipo o evento')} initial={typing} onSubmit={find} onClose={() => setTyping(null)} />;
  if (found) {
    return <MenuModal title={t('Canales con «{x}»', { x: found.q })} opts={found.list.map(ch => ({ title: ch.name, green: true, onPress: () => play(ch) }))} onClose={() => setFound(null)} />;
  }
  const m = c.m;
  const best = m?.best || c.best;
  const opts: MenuOpt[] = [{ title: '▶  ' + t('Ver el evento (canal automático)'), sub: best.name, green: true, onPress: () => play(best) }];
  const seen = new Set<string>([best.id]);
  for (const tv of m?.tv || []) {
    if (tv.ch && seen.has(tv.ch.id)) continue;
    if (c.iptv && !tv.ch) continue;
    if (tv.ch) seen.add(tv.ch.id);
    opts.push({
      title: c.iptv && tv.ch ? tv.ch.name : tv.n + (tv.c ? ' (' + tv.c + ')' : ''),
      sub: (tv.u ? t('suele transmitirlo') + ' · ' : '') + (tv.ch ? t('en tu lista: {x}', { x: tv.ch.name }) : t('no está en tu lista: se busca el evento')),
      green: !!tv.ch,
      onPress: () => (tv.ch ? play(tv.ch) : m?.teams ? play(m.teams) : c.folder ? play(c.folder) : find(c.solo ? c.ev : c.h)),
    });
  }
  for (const [ch, why] of [...(m?.epg || []).map(x => [x, t('en la guía')] as const), ...(m?.teams ? [[m.teams, t('por equipos')] as const] : [])]) {
    if (seen.has(ch.id) || opts.length > 10) continue;
    seen.add(ch.id);
    opts.push({ title: ch.name + ' · ' + why, green: true, onPress: () => play(ch) });
  }
  const names = c.solo ? [c.ev] : [c.h, c.a].filter(Boolean);
  for (const n of names) opts.push({ title: t('Buscar canales: «{x}»', { x: n }), onPress: () => find(n) });
  opts.push({ title: t('Buscar canal, equipo o evento…'), onPress: () => setTyping(names[0] || '') });
  return <MenuModal title={c.solo ? c.ev : c.h + ' vs ' + c.a} sub={t('¿Dónde quieres verlo?')} opts={opts} onClose={onClose} />;
}
