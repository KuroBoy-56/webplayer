# Pendiente en Vega: lo que se corrigió en Roku

Vega 1.0.7 tiene todo lo de Roku hasta el build 66 (rama `main` del repo `roku`): carátulas y plataformas, Continuar
viendo por pasos (nunca desde el principio solo), la consulta al servidor cuando un video no abre (403 / 404 /
extensión / cuenta), el panel por http o con el video convertido como último recurso, los idiomas leídos con el video
ya abierto y reintentados hasta tenerlos, el menú de audio con «Audio predeterminado» arriba y todos los idiomas por el
panel, y el borrado de caché (`cache_clear_at`, `poll: 1`, espera a salir del reproductor). Ver el README.

## Falta en Vega

- Nada por ahora. Lo nuevo que se corrija en Roku se anota aquí.

## Después de copiar

- Subir la versión (`manifest.toml`, `package.json`, `package-lock.json`, `src/version.ts`).
- `npx tsc -p tsconfig.json --noEmit` y `npm run bundle:check`.
- Subir a `vega-os` y esperar la compilación de GitHub (Releases › vega-latest).
