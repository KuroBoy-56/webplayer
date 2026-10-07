import { createContext, useContext } from 'react';
import type { Item } from './data/catalog';

export type QueueEntry = { id: string; title: string; ext: string; poster: string; season?: number; num?: number };

export type PlayParams =
  | { kind: 'movie' | 'episode'; queue: QueueEntry[]; index: number; saveTitle: string; savePoster: string; cat: string; seriesId: string; resume: number }
  | { kind: 'live'; channel: Item; channels: Item[]; index: number };

export type Route =
  | { name: 'login' }
  | { name: 'main' }
  | { name: 'detail'; item: Item }
  | { name: 'grid'; title: string; mode: 'cat' | 'platform' | 'genre' | 'recent'; key: string; kind?: 'vod' | 'series' }
  | { name: 'player'; params: PlayParams };

export type Nav = {
  push: (r: Route) => void;
  pop: () => void;
  reset: (r: Route) => void;
};

export const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, reset: () => {} });
export const useNav = () => useContext(NavContext);
