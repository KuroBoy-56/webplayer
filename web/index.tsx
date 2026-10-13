// Entrada de la app de Tizen: la misma app de Vega OS (src/) con react-native-web.
import { AppRegistry } from 'react-native-web';
import App from '../src/App';
import { installRemote } from './remote';

installRemote();
AppRegistry.registerComponent('mpx', () => App);
AppRegistry.runApplication('mpx', { rootTag: document.getElementById('root') });
