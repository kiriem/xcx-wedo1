/**
 * This is an extension for Xcratch.
 */

import iconURL from './entry-icon.svg';
import insetIconURL from './inset-icon.svg';
import connectionIconURL from './connection-icon.svg';
import translations from './translations.json';
import {version as packageVersion} from '../../../../../../package.json';
import {getCurrentLocale} from '../../../../../shared/current-locale';

/**
 * Formatter to translate the messages in this extension.
 * This will be replaced which is used in the React component.
 * @param {object} messageData - data for format-message
 * @returns {string} - translated message for the current locale
 */
let formatMessage = messageData => messageData.defaultMessage;

/**
 * Translate with this entry's own messages for the locale the VM reports, falling back to the injected formatter.
 * Xcratch injects the formatter only when the extension library opens, so a connection modal shown right after
 * loading this extension by URL would otherwise stay in English.
 * @param {object} messageData - data for format-message
 * @returns {string} - translated message for the current locale
 */
const translate = messageData => {
    const messages = translations[getCurrentLocale()];
    if (messages && messages[messageData.id]) return messages[messageData.id];
    return formatMessage(messageData);
};

const version = `v${packageVersion}`;

const entry = {
    get name () {
        return translate({
            id: 'wedo1.entry.name',
            defaultMessage: 'LEGO WeDo 1.0',
            description: 'name of the extension'
        });
    },
    extensionId: 'wedo1',
    extensionURL: 'https://kiriem.github.io/xcx-wedo1/dist/wedo1.mjs',
    collaborator: 'kiriem',
    iconURL: iconURL,
    insetIconURL: insetIconURL,
    get description () {
        return `${translate({
            defaultMessage: 'Control the USB WeDo 1.0 hub\'s motors and sensors.',
            description: 'Description for this extension',
            id: 'wedo1.entry.description'
        })} (${version})`;
    },
    tags: [],
    featured: true,
    disabled: false,
    bluetoothRequired: false,
    internetConnectionRequired: false,
    launchPeripheralConnectionFlow: true,
    useAutoScan: true,
    connectionIconURL: connectionIconURL,
    connectionSmallIconURL: insetIconURL,
    connectionTipIconURL: connectionIconURL,
    get prescanMessage () {
        return translate({
            // eslint-disable-next-line max-len
            defaultMessage: 'Plug your LEGO WeDo 1.0 hub into a USB port, then press the button below and choose it from the browser\'s list.',
            description: 'Prompt before searching for a LEGO WeDo 1.0',
            id: 'wedo1.entry.prescanMessage'
        });
    },
    get scanBeginMessage () {
        return translate({
            defaultMessage: 'Choose your LEGO WeDo 1.0 in the browser\'s list.',
            description: 'Information shown while the browser\'s USB device chooser is open',
            id: 'wedo1.entry.scanBeginMessage'
        });
    },
    get connectingMessage () {
        return translate({
            defaultMessage: 'Connecting',
            description: 'Message to help people connect to their WeDo 1.0.',
            id: 'wedo1.entry.connectingMessage'
        });
    },
    helpLink: 'https://kiriem.github.io/xcx-wedo1/',
    setFormatMessage: formatter => {
        formatMessage = formatter;
    },
    translationMap: translations
};

export {entry}; // loadable-extension needs this line.
export default entry;
