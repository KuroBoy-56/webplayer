# PENDIENTE-2811 — lista de trabajo para otra sesión de Claude

Palabra clave: **PENDIENTE-2811**. Si la sesión anterior se cortó, este archivo dice qué falta. Marca `[x]` lo que
termines y haz commit de este archivo (rama `main` de KuroBoy-56/webplayer, con `[skip ci]`).

Reglas de siempre: responder en español; no tocar la VPS; no subir secretos (config/panel.key,
includes/panel_secret.php, includes/secrets.php, api/progress/.integrity/, JSON de cuentas de servicio); no publicar
builds de Android (solo compilar); cada número de versión de un dígito (x.y.9 → x.(y+1).0); README/CAMBIOS al día;
commits: Android / Windows (wipmacos main) / Roku con `[skip ci]`, macOS (wm) sin él, Linux (wl) con `[linux build]`,
webOS / Tizen / VIDAA / Vega / iOS sin `[skip ci]` (compilan en CI); lista al usuario los archivos del panel y del
web player que tiene que subir.

Repos locales: webplayer (main), panelweb, wipmacos (main) / wm (macos) / wl (linux), android / aw-android-sin-certificado /
aw-play-store (celular), aw-android-tv / aw-android-tv-sin-certificado / pstv (TV), ios, webos / tizen / vidaa / vega
(rama de KuroBoy-56/webplayer), roku.

## 1. «Ligas favoritas» → «Eventos favoritos» (todas las apps con Ajustes › Deporte favorito)
- [x] Panel `includes/sports_engine.php` `sp_payload()`: agregar `cups` = las competiciones de `ST_LEAGUES`
      (`includes/sports_tables.php`) con región `intl` o `nat` → `[{id, n, sp, rg}]` (Champions, Europa, Conference,
      Libertadores, Sudamericana, CONCACAF Champions Cup, Mundial FIFA, Eliminatorias, Copa Oro, Copa América, Eurocopa…).
      Hoy la lista solo sale de la agenda de hoy/mañana + las ligas que eligió el distribuidor, por eso no aparecen.
- [ ] En cada app, `leagueChoices` (o su equivalente) suma `cups` de `api/sports.php` (sin escudo, today 0).
- [ ] Renombrar «Ligas favoritas» → «Eventos favoritos», «Todas las ligas» → «Todos los eventos», «{n} ligas» →
      «{n} eventos» (es/en/pt/fr).
- [ ] Sin deporte favorito elegido: al abrir «Eventos favoritos», mensaje «Primero elige tu deporte favorito para
      elegir tus eventos.» (sin lista). Con deporte: solo los de ese deporte (ya filtra por `sp`).
- Apps: web player, escritorio ×3, Android celular ×3, Android TV ×3, webOS/Tizen/VIDAA/Vega, Roku (iOS no lo tiene).
  RN: `src/data/liveTv.ts` `leagueChoices`, `src/screens/Account.tsx`. Android TV: `TvTeams.kt` `TvLeaguePrefDialog`,
  `SportsLive.leagueChoices()`. Escritorio: `settings-live-sports.util.ts` `leagueChoices`,
  `settings-live-sports-section.component.ts`. Roku: `NetTask.brs` `doLeagueList`, `AccountSection.brs`.

## 2. Explorar (la lupa): sin botón «Categorías» y con «Z - A»
- [ ] Quitar el botón / selector «Categorías» de Explorar en todas las apps que lo tienen.
- [ ] Ordenar: Agregados recientemente, A - Z, **Z - A** (nuevo), Mejor valorados. También en el web player
      (browse.php) y en iOS (menú Ordenar de BrowseView).

## 3. «Ver todo» al final de las filas (Inicio, Top 10, Películas agregadas recientemente, Series nuevas…)
- [ ] La tarjeta «Ver todo» del final de la fila: misma forma/tamaño que las tarjetas de esa fila, fondo translúcido
      (no color sólido), texto «Ver todo» legible. Apps con tarjeta al final: Android TV ×3, webOS/Tizen/VIDAA/Vega,
      Roku (revisar Android celular y escritorio).

## 4. «Ir a Deportes» (tarjeta final de «En vivo ahora»)
- [ ] Fondo = miniatura de la imagen de fondo de Deportes (estadio, `sports-bg`) translúcida, con «Ir a Deportes»
      legible encima. Todas las apps con la fila «En vivo ahora».

## 5. Solo Roku
- [ ] Bug: «Ver todo» de «Series nuevas» → Explorar → Atrás: toda la fila quedó con el foco pintado (se podía mover).
      Pasó una vez; revisar `RowsSection.brs` (restaurar foco al volver de Explorar).
- [ ] Ficha (DetailView): al bajar se oculta el detalle y suben título y miniaturas pero el foco no queda abajo; al
      volver a bajar todo sube bien pero «Más títulos como este» desaparece y queda un espacio en blanco. Corregir el
      desplazamiento de `DetailView.brs`.

## Hecho
- Panel: `sp_cups()` en `includes/sports_engine.php` (commit ec58641, panelweb) — subir `includes/sports_engine.php` y `api/sports.php`.
- webOS 1.6.4, Tizen 1.5.4, VIDAA 1.1.8, Vega 2.9.5: puntos 1–4 hechos (scripts en scratchpad: rn_events.py, rn_explore.py, rn_tiles.py).
- Android TV 1.8.2 / sin certificado 1.8.3 / pstv 1.8.2: puntos 1–4 hechos.
- Roku 2.8.6: puntos 1–5 hechos (refoco defensivo en RowsSection.setContent; ficha: listMode con la fila abajo).
- Escritorio Windows/macOS/Linux 1.8.1 y Android celular 1.7.6 / sin certificado 1.7.8 / Play Store 1.7.7: hechos (celular no tiene selector de categorías; solo Z - A).
- Falta: web player (Eventos favoritos en Ajustes, Z - A en browse.php, Ir a Deportes translúcido) e iOS (Z - A).
