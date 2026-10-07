// Prepara la llave maestra del panel para la compilación (Autodemo y registro del equipo).
// Origen: variable PANEL_KEY (secreto de GitHub) o el archivo config/panel.key.
// Escribe src/generated/panelKey.ts, que está en .gitignore y nunca se sube.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'config', 'panel.key');
let raw = process.env.PANEL_KEY || '';
let from = 'secreto PANEL_KEY';
if (!raw && fs.existsSync(file)) {
  raw = fs.readFileSync(file, 'utf8');
  from = 'config/panel.key';
}
const hex = raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
const key = hex.length === 64 ? hex : '';
if (raw && !key) console.warn('Llave del panel no válida (deben ser 64 caracteres hex): se compila sin llave.');
console.log(key ? 'Llave del panel incluida desde ' + from + '.' : 'Compilando sin llave del panel (sin Autodemo ni registro del equipo).');

const out = path.join(root, 'src', 'generated');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'panelKey.ts'),
  '// Generado por tools/prepare-key.js. No subir al repositorio.\nexport const PANEL_KEY: string = ' + JSON.stringify(key) + ';\n',
);
