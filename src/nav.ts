import { createContext, useContext } from 'react';
import type { Item } from './data/catalog';
import type { Review } from './api/panel';

// dur: duración que da el servidor (segundos), para el progreso cuando el reproductor no la sabe
export type QueueEntry = { id: string; title: string; ext: string; poster: string; season?: number; num?: number; dur?: number };

export type PlayParams =
  | { kind: 'movie' | 'episode'; queue: QueueEntry[]; index: number; saveTitle: string; savePoster: string; cat: string; seriesId: string; resume: number }
  | { kind: 'live'; channel: Item; channels: Item[]; index: number };

export type ExploreSort = 'recent' | 'az' | 'za' | 'rating';
export type ExploreInit = {
  type?: 'all' | 'vod' | 'series';
  sort?: ExploreSort;
  platform?: string;
  genre?: string;
  cat?: { id: string; name: string; kind: 'vod' | 'series' };
};

export type Route =
  | { name: 'distributor'; message?: string }
  | { name: 'tenant_retry'; message: string }
  | { name: 'login' }
  | { name: 'main' }
  // «¿Quién está viendo?» (perfiles del panel): 'start' al entrar (Atrás pregunta si salir), 'menu' desde la barra
  | { name: 'profiles'; from: 'start' | 'menu'; manage?: boolean }
  | { name: 'detail'; item: Item }
  | { name: 'actor'; personId: number; actorName: string }
  | { name: 'grid'; title: string; mode: 'cat' | 'platform' | 'genre' | 'recent' | 'continue' | 'mylist'; key: string; kind?: 'vod' | 'series' }
  // «Ver todo» de una fila (como browse.php del web player): Explorar con el filtro de esa fila
  | { name: 'explore'; init: ExploreInit }
  | { name: 'player'; params: PlayParams }
  // tema de prueba del panel (Pantalla Falsa, solo con Omitir)
  | { name: 'review'; data: Review };

export type Nav = {
  push: (r: Route) => void;
  pop: () => void;
  reset: (r: Route) => void;
  // aplica la marca del distribuidor (logo, nombre y colores) y abre r
  rebrand: (r: Route) => void;
};

export const NavContext = createContext<Nav>({ push: () => {}, pop: () => {}, reset: () => {}, rebrand: () => {} });
export const useNav = () => useContext(NavContext);
