import { createContext, useContext } from 'react';
import type { Item } from './data/catalog';

// dur: duración que da el servidor (segundos), para el progreso cuando el reproductor no la sabe
export type QueueEntry = { id: string; title: string; ext: string; poster: string; season?: number; num?: number; dur?: number };

export type PlayParams =
  | { kind: 'movie' | 'episode'; queue: QueueEntry[]; index: number; saveTitle: string; savePoster: string; cat: string; seriesId: string; resume: number }
  | { kind: 'live'; channel: Item; channels: Item[]; index: number };

export type Route =
  | { name: 'distributor'; message?: string }
  | { name: 'tenant_retry'; message: string }
  | { name: 'login' }
  | { name: 'main' }
  | { name: 'detail'; item: Item }
  | { name: 'actor'; personId: number; actorName: string }
  | { name: 'grid'; title: string; mode: 'cat' | 'platform' | 'genre' | 'recent'; key: string; kind?: 'vod' | 'series' }
  | { name: 'player'; params: PlayParams };

export type Nav = {
  push: (r: Route) => void;
  pop: () => void;
  reset: (r: Route) => void;
  // aplica la marca del distribuidor (logo, nombre y colores) y abre r
  rebrand: (r: Route) => void;
};

export const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, reset: () => {}, rebrand: () => {} });
export const useNav = () => useContext(NavContext);
