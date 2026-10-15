// Entrada de la app de webOS (LG): la misma app de Vega OS (src/) con react-native-web.
// primero lo que les falta a los televisores viejos (antes de evaluar cualquier otro módulo)
import './polyfills';
import { AppRegistry } from 'react-native-web';
import App from '../src/App';
import { initTv } from '../src/lib/platform';
import { installRemote } from './remote';

installRemote();
// el id del televisor (LGUDID) tiene que estar antes del primer check_mac
initTv().finally(() => {
  AppRegistry.registerComponent('mpx', () => App);
  AppRegistry.runApplication('mpx', { rootTag: document.getElementById('root') });
});
