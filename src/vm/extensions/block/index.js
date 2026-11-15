import BlockType from '../../extension-support/block-type';
import ArgumentType from '../../extension-support/argument-type';
import Cast from '../../util/cast';
import MathUtil from '../../util/math-util';
import translations from './translations.json';
import blockIcon from './block-icon.svg';
import {setCurrentLocale} from '../../../shared/current-locale';
import {
    VENDOR_ID,
    PRODUCT_ID,
    DeviceType,
    TiltDirection,
    deviceTypeFromId,
    tiltFromRaw,
    distanceFromRaw,
    powerToPwm,
    encodeMotorCommand,
    decodeInputReport
} from './protocol';

/**
 * Formatter which is used for translation.
 * This will be replaced which is used in the runtime.
 * @param {object} messageData - format-message object
 * @returns {string} - message for the locale
 */
let formatMessage = messageData => messageData.default;

/**
 * Setup format-message for this extension.
 */
const setupTranslations = () => {
    const localeSetup = formatMessage.setup();
    if (localeSetup) setCurrentLocale(localeSetup.locale);
    if (localeSetup && localeSetup.translations[localeSetup.locale]) {
        Object.assign(
            localeSetup.translations[localeSetup.locale],
            translations[localeSetup.locale]
        );
    }
};

const EXTENSION_ID = 'wedo1';

/**
 * URL to get this extension as a module.
 * When it was loaded as a module, 'extensionURL' will be replaced a URL which is retrieved from.
 * @type {string}
 */
let extensionURL = 'https://kiriem.github.io/xcx-wedo1/dist/wedo1.mjs';

/**
 * Number of ports on the WeDo 1.0 hub.
 * @type {number}
 */
const PORT_COUNT = 2;

/**
 * Delay after a motor command before the block yields, so a script's next command is not sent in the same frame.
 * @type {number}
 */
const COMMAND_DELAY_MS = 30;

/**
 * Manage power, direction, and timers for one WeDo 1.0 motor port.
 */
class WeDo1Motor {
    /**
     * @param {WeDo1} parent - the hub this motor port belongs to.
     */
    constructor (parent) {
        this._parent = parent;
        this.direction = 1;
        this.power = 100;
        this.isOn = false;
        this._pendingTimeoutId = null;
    }

    /**
     * @returns {number} - the signed PWM value this motor should currently be driven at.
     */
    get pwm () {
        return this.isOn ? powerToPwm(this.power, this.direction) : 0;
    }

    turnOn () {
        this.clearTimeout();
        this.isOn = true;
        this._parent.sendMotorState();
    }

    /**
     * @param {number} milliseconds - run the motor for this long, then turn it off.
     */
    turnOnFor (milliseconds) {
        this.turnOn();
        this._pendingTimeoutId = setTimeout(() => {
            this._pendingTimeoutId = null;
            this.turnOff();
        }, Math.max(0, milliseconds));
    }

    turnOff () {
        this.clearTimeout();
        this.isOn = false;
        this._parent.sendMotorState();
    }

    clearTimeout () {
        if (this._pendingTimeoutId !== null) {
            clearTimeout(this._pendingTimeoutId);
            this._pendingTimeoutId = null;
        }
    }
}

/**
 * A LEGO WeDo 1.0 hub connected over USB, accessed through WebHID.
 */
class WeDo1 {
    /**
     * @param {Runtime} runtime - the Scratch 3.0 runtime.
     * @param {string} extensionId - the id of the extension using this peripheral.
     */
    constructor (runtime, extensionId) {
        this._runtime = runtime;
        this._extensionId = extensionId;

        /**
         * Devices returned by the most recent WebHID chooser, indexed by peripheral id.
         * @type {Array<HIDDevice>}
         */
        this._availableDevices = [];

        /** @type {?HIDDevice} */
        this._device = null;

        this._motors = [new WeDo1Motor(this), new WeDo1Motor(this)];
        this._ports = [];
        this._resetPorts();

        this._sendInFlight = false;
        this._sendQueued = false;

        this._onInputReport = this._onInputReport.bind(this);
        this._onHidDisconnect = this._onHidDisconnect.bind(this);

        this._runtime.registerPeripheralExtension(extensionId, this);
        this._runtime.on('PROJECT_STOP_ALL', this.stopAll.bind(this));
    }

    /**
     * @param {number} index - zero-based port index.
     * @returns {WeDo1Motor} - the motor state for that port.
     */
    motor (index) {
        return this._motors[index];
    }

    /**
     * @param {number} index - zero-based port index.
     * @returns {{type: string, id: number, value: number}} - the latest reading for that port.
     */
    port (index) {
        return this._ports[index];
    }

    /**
     * @param {string} type - the DeviceType to look for.
     * @returns {?{type: string, id: number, value: number}} - the first port with that device plugged in.
     */
    findPort (type) {
        return this._ports.find(p => p.type === type) || null;
    }

    stopAll () {
        if (!this.isConnected()) return;
        this._motors.forEach(motor => motor.turnOff());
    }

    /**
     * Called by the runtime when the user starts a scan. WebHID only lets a page reach devices the user picked in
     * the browser's chooser, so the chooser stands in for the scan results.
     */
    scan () {
        if (!navigator.hid) {
            console.warn('WeDo 1.0: WebHID is not available in this browser.');
            this._runtime.emit(this._runtime.constructor.PERIPHERAL_REQUEST_ERROR, {
                message: 'WebHID is not available',
                extensionId: this._extensionId
            });
            return;
        }
        navigator.hid.requestDevice({filters: [{vendorId: VENDOR_ID, productId: PRODUCT_ID}]})
            .then(devices => {
                this._availableDevices = devices;
                if (devices.length === 0) {
                    this._runtime.emit(this._runtime.constructor.PERIPHERAL_SCAN_TIMEOUT);
                    return;
                }
                const peripherals = {};
                devices.forEach((device, index) => {
                    peripherals[index] = {
                        peripheralId: index,
                        name: device.productName || 'LEGO WeDo 1.0',
                        rssi: 0
                    };
                });
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_LIST_UPDATE, peripherals);
            })
            .catch(error => {
                console.warn(`WeDo 1.0: requestDevice failed: ${error}`);
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_SCAN_TIMEOUT);
            });
    }

    /**
     * Called by the runtime when the user picks a peripheral to connect to.
     * @param {number} id - index into the devices returned by the chooser.
     */
    connect (id) {
        const device = this._availableDevices[id];
        if (!device) {
            console.error(`WeDo 1.0: connect called with unknown peripheral id ${id}`);
            this._runtime.emit(this._runtime.constructor.PERIPHERAL_REQUEST_ERROR, {
                message: 'Unknown peripheral',
                extensionId: this._extensionId
            });
            return;
        }
        const opening = device.opened ? Promise.resolve() : device.open();
        opening
            .then(() => {
                this._device = device;
                device.addEventListener('inputreport', this._onInputReport);
                navigator.hid.addEventListener('disconnect', this._onHidDisconnect);
                this._motors.forEach(motor => {
                    motor.isOn = false;
                });
                this.sendMotorState();
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_CONNECTED);
            })
            .catch(error => {
                console.warn(`WeDo 1.0: failed to open device: ${error}`);
                this._runtime.emit(this._runtime.constructor.PERIPHERAL_REQUEST_ERROR, {
                    message: `Failed to open WeDo 1.0: ${error}`,
                    extensionId: this._extensionId
                });
            });
    }

    /**
     * Called by the runtime when the user disconnects, or cancels a scan.
     */
    disconnect () {
        const device = this._device;
        if (!device) return;
        this._motors.forEach(motor => motor.clearTimeout());
        // Stop the motors before closing: the hub keeps driving them at the last commanded power otherwise.
        device.sendReport(0, encodeMotorCommand(0, 0))
            .catch(() => {})
            .then(() => device.close())
            .catch(() => {});
        this._teardown();
        this._runtime.emit(this._runtime.constructor.PERIPHERAL_DISCONNECTED);
    }

    /**
     * @returns {boolean} - whether a hub is connected.
     */
    isConnected () {
        return this._device !== null;
    }

    /**
     * Send both ports' current motor power to the hub. Sends are serialized; if one is in flight, the latest state
     * is sent once it completes.
     */
    sendMotorState () {
        if (!this._device) return;
        if (this._sendInFlight) {
            this._sendQueued = true;
            return;
        }
        this._sendInFlight = true;
        const device = this._device;
        device.sendReport(0, encodeMotorCommand(this._motors[0].pwm, this._motors[1].pwm))
            .catch(error => console.warn(`WeDo 1.0: sendReport failed: ${error}`))
            .then(() => {
                this._sendInFlight = false;
                if (this._sendQueued && this._device === device) {
                    this._sendQueued = false;
                    this.sendMotorState();
                }
            });
    }

    /**
     * @param {HIDInputReportEvent} event - an input report from the hub.
     */
    _onInputReport (event) {
        decodeInputReport(event.data).forEach((reading, index) => {
            this._ports[index] = {
                type: deviceTypeFromId(reading.id),
                id: reading.id,
                value: reading.value
            };
        });
    }

    /**
     * @param {HIDConnectionEvent} event - a WebHID device was unplugged.
     */
    _onHidDisconnect (event) {
        if (event.device !== this._device) return;
        this._motors.forEach(motor => motor.clearTimeout());
        this._teardown();
        this._runtime.emit(this._runtime.constructor.PERIPHERAL_CONNECTION_LOST_ERROR, {
            message: `Scratch lost connection to`,
            extensionId: this._extensionId
        });
    }

    _teardown () {
        if (this._device) {
            this._device.removeEventListener('inputreport', this._onInputReport);
        }
        navigator.hid.removeEventListener('disconnect', this._onHidDisconnect);
        this._device = null;
        this._sendInFlight = false;
        this._sendQueued = false;
        this._motors.forEach(motor => {
            motor.isOn = false;
        });
        this._resetPorts();
    }

    _resetPorts () {
        for (let i = 0; i < PORT_COUNT; i++) {
            this._ports[i] = {type: DeviceType.NONE, id: 0, value: 0};
        }
    }
}

/**
 * Motor menu values.
 * @readonly
 * @enum {string}
 */
const MotorLabel = {
    ALL: 'all motors',
    A: 'motor A',
    B: 'motor B'
};

/**
 * Motor direction menu values.
 * @readonly
 * @enum {string}
 */
const MotorDirection = {
    FORWARD: 'this way',
    BACKWARD: 'that way',
    REVERSE: 'reverse'
};

/**
 * Port menu values.
 * @readonly
 * @enum {string}
 */
const Port = {
    A: 'A',
    B: 'B'
};

const TILT_ANY = 'any';

/**
 * Scratch 3.0 blocks to interact with a LEGO WeDo 1.0 hub over USB.
 */
class ExtensionBlocks {
    /**
     * A translation object which is used in this class.
     * @param {FormatObject} formatter - translation object
     */
    static set formatMessage (formatter) {
        formatMessage = formatter;
        if (formatMessage) setupTranslations();
    }

    /**
     * @return {string} - the name of this extension.
     */
    static get EXTENSION_NAME () {
        return formatMessage({
            id: 'wedo1.name',
            default: 'WeDo 1.0',
            description: 'name of the extension'
        });
    }

    /**
     * @return {string} - the ID of this extension.
     */
    static get EXTENSION_ID () {
        return EXTENSION_ID;
    }

    /**
     * URL to get this extension.
     * @type {string}
     */
    static get extensionURL () {
        return extensionURL;
    }

    /**
     * Set URL to get this extension.
     * The extensionURL will be changed to the URL of the loading server.
     * @param {string} url - URL
     */
    static set extensionURL (url) {
        extensionURL = url;
    }

    /**
     * Construct a set of blocks for LEGO WeDo 1.0.
     * @param {Runtime} runtime - the Scratch 3.0 runtime.
     */
    constructor (runtime) {
        /**
         * The Scratch 3.0 runtime.
         * @type {Runtime}
         */
        this.runtime = runtime;

        if (runtime.formatMessage) {
            // Replace 'formatMessage' to a formatter which is used in the runtime.
            formatMessage = runtime.formatMessage;
        }

        this._peripheral = new WeDo1(this.runtime, EXTENSION_ID);
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        setupTranslations();
        const motorIdArg = {
            type: ArgumentType.STRING,
            menu: 'MOTOR_ID',
            defaultValue: MotorLabel.ALL
        };
        const tiltArg = {
            type: ArgumentType.STRING,
            menu: 'TILT_DIRECTION_ANY',
            defaultValue: TILT_ANY
        };
        return {
            id: ExtensionBlocks.EXTENSION_ID,
            name: ExtensionBlocks.EXTENSION_NAME,
            extensionURL: ExtensionBlocks.extensionURL,
            blockIconURI: blockIcon,
            showStatusButton: true,
            blocks: [
                {
                    opcode: 'motorOnFor',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'wedo1.motorOnFor',
                        default: 'turn [MOTOR_ID] on for [DURATION] seconds',
                        description: 'turn a motor on for some time'
                    }),
                    arguments: {
                        MOTOR_ID: motorIdArg,
                        DURATION: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1
                        }
                    }
                },
                {
                    opcode: 'motorOn',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'wedo1.motorOn',
                        default: 'turn [MOTOR_ID] on',
                        description: 'turn a motor on indefinitely'
                    }),
                    arguments: {
                        MOTOR_ID: motorIdArg
                    }
                },
                {
                    opcode: 'motorOff',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'wedo1.motorOff',
                        default: 'turn [MOTOR_ID] off',
                        description: 'turn a motor off'
                    }),
                    arguments: {
                        MOTOR_ID: motorIdArg
                    }
                },
                {
                    opcode: 'startMotorPower',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'wedo1.startMotorPower',
                        default: 'set [MOTOR_ID] power to [POWER]',
                        description: 'set the motor\'s power and turn it on'
                    }),
                    arguments: {
                        MOTOR_ID: motorIdArg,
                        POWER: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 100
                        }
                    }
                },
                {
                    opcode: 'setMotorDirection',
                    blockType: BlockType.COMMAND,
                    text: formatMessage({
                        id: 'wedo1.setMotorDirection',
                        default: 'set [MOTOR_ID] direction to [MOTOR_DIRECTION]',
                        description: 'set the motor\'s turn direction'
                    }),
                    arguments: {
                        MOTOR_ID: motorIdArg,
                        MOTOR_DIRECTION: {
                            type: ArgumentType.STRING,
                            menu: 'MOTOR_DIRECTION',
                            defaultValue: MotorDirection.FORWARD
                        }
                    }
                },
                '---',
                {
                    opcode: 'whenDistance',
                    blockType: BlockType.HAT,
                    text: formatMessage({
                        id: 'wedo1.whenDistance',
                        default: 'when distance [OP] [REFERENCE]',
                        description: 'check for when distance is < or > than reference'
                    }),
                    arguments: {
                        OP: {
                            type: ArgumentType.STRING,
                            menu: 'OP',
                            defaultValue: '<'
                        },
                        REFERENCE: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 50
                        }
                    }
                },
                {
                    opcode: 'whenTilted',
                    blockType: BlockType.HAT,
                    func: 'isTilted',
                    text: formatMessage({
                        id: 'wedo1.whenTilted',
                        default: 'when tilted [TILT_DIRECTION_ANY]',
                        description: 'check when tilted in a certain direction'
                    }),
                    arguments: {
                        TILT_DIRECTION_ANY: tiltArg
                    }
                },
                {
                    opcode: 'getDistance',
                    blockType: BlockType.REPORTER,
                    text: formatMessage({
                        id: 'wedo1.getDistance',
                        default: 'distance',
                        description: 'the value returned by the distance sensor'
                    })
                },
                {
                    opcode: 'isTilted',
                    blockType: BlockType.BOOLEAN,
                    text: formatMessage({
                        id: 'wedo1.isTilted',
                        default: 'tilted [TILT_DIRECTION_ANY]?',
                        description: 'whether the tilt sensor is tilted'
                    }),
                    arguments: {
                        TILT_DIRECTION_ANY: tiltArg
                    }
                },
                {
                    opcode: 'getSensorValue',
                    blockType: BlockType.REPORTER,
                    text: formatMessage({
                        id: 'wedo1.getSensorValue',
                        default: 'port [PORT] raw sensor value',
                        description: 'the unprocessed 0-255 value read from a WeDo 1.0 hub port'
                    }),
                    arguments: {
                        PORT: {
                            type: ArgumentType.STRING,
                            menu: 'PORT',
                            defaultValue: Port.A
                        }
                    }
                }
            ],
            menus: {
                MOTOR_ID: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'wedo1.motorId.all',
                                default: 'all motors',
                                description: 'label for all motors in the motor menu'
                            }),
                            value: MotorLabel.ALL
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.motorId.a',
                                default: 'motor A',
                                description: 'label for motor A in the motor menu'
                            }),
                            value: MotorLabel.A
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.motorId.b',
                                default: 'motor B',
                                description: 'label for motor B in the motor menu'
                            }),
                            value: MotorLabel.B
                        }
                    ]
                },
                MOTOR_DIRECTION: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'wedo1.motorDirection.forward',
                                default: 'this way',
                                description: 'label for forward in the motor direction menu'
                            }),
                            value: MotorDirection.FORWARD
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.motorDirection.backward',
                                default: 'that way',
                                description: 'label for backward in the motor direction menu'
                            }),
                            value: MotorDirection.BACKWARD
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.motorDirection.reverse',
                                default: 'reverse',
                                description: 'label for reverse in the motor direction menu'
                            }),
                            value: MotorDirection.REVERSE
                        }
                    ]
                },
                TILT_DIRECTION_ANY: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'wedo1.tiltDirection.up',
                                default: 'up',
                                description: 'label for up in the tilt direction menu'
                            }),
                            value: TiltDirection.UP
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.tiltDirection.down',
                                default: 'down',
                                description: 'label for down in the tilt direction menu'
                            }),
                            value: TiltDirection.DOWN
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.tiltDirection.left',
                                default: 'left',
                                description: 'label for left in the tilt direction menu'
                            }),
                            value: TiltDirection.LEFT
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.tiltDirection.right',
                                default: 'right',
                                description: 'label for right in the tilt direction menu'
                            }),
                            value: TiltDirection.RIGHT
                        },
                        {
                            text: formatMessage({
                                id: 'wedo1.tiltDirection.any',
                                default: 'any',
                                description: 'label for any direction in the tilt direction menu'
                            }),
                            value: TILT_ANY
                        }
                    ]
                },
                OP: {
                    acceptReporters: true,
                    items: ['<', '>']
                },
                PORT: {
                    acceptReporters: true,
                    items: [Port.A, Port.B]
                }
            }
        };
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {Promise} - resolves at the end of the duration.
     */
    motorOnFor (args) {
        const durationMS = MathUtil.clamp(Cast.toNumber(args.DURATION) * 1000, 0, 15000);
        return new Promise(resolve => {
            this._forEachMotor(args.MOTOR_ID, motor => motor.turnOnFor(durationMS));
            setTimeout(resolve, durationMS);
        });
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {Promise} - resolves after a short delay.
     */
    motorOn (args) {
        this._forEachMotor(args.MOTOR_ID, motor => motor.turnOn());
        return this._commandDelay();
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {Promise} - resolves after a short delay.
     */
    motorOff (args) {
        this._forEachMotor(args.MOTOR_ID, motor => motor.turnOff());
        return this._commandDelay();
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {Promise} - resolves after a short delay.
     */
    startMotorPower (args) {
        const power = MathUtil.clamp(Cast.toNumber(args.POWER), 0, 100);
        this._forEachMotor(args.MOTOR_ID, motor => {
            motor.power = power;
            motor.turnOn();
        });
        return this._commandDelay();
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {Promise} - resolves after a short delay.
     */
    setMotorDirection (args) {
        this._forEachMotor(args.MOTOR_ID, motor => {
            switch (args.MOTOR_DIRECTION) {
            case MotorDirection.FORWARD:
                motor.direction = 1;
                break;
            case MotorDirection.BACKWARD:
                motor.direction = -1;
                break;
            case MotorDirection.REVERSE:
                motor.direction = -motor.direction;
                break;
            default:
                console.warn(`Unknown motor direction in setMotorDirection: ${args.MOTOR_DIRECTION}`);
                return;
            }
            // Re-send so a running motor changes direction immediately; any pending timer keeps running.
            if (motor.isOn) {
                this._peripheral.sendMotorState();
            }
        });
        return this._commandDelay();
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {boolean} - whether the distance compares to the reference as requested.
     */
    whenDistance (args) {
        if (!this._peripheral.findPort(DeviceType.DISTANCE)) return false;
        const distance = this.getDistance();
        switch (args.OP) {
        case '<':
            return distance < Cast.toNumber(args.REFERENCE);
        case '>':
            return distance > Cast.toNumber(args.REFERENCE);
        default:
            console.warn(`Unknown comparison operator in whenDistance: ${args.OP}`);
            return false;
        }
    }

    /**
     * @returns {number} - the distance sensor's value scaled to [0,100], or 0 if no distance sensor is plugged in.
     */
    getDistance () {
        const port = this._peripheral.findPort(DeviceType.DISTANCE);
        return port ? distanceFromRaw(port.value) : 0;
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {boolean} - whether the tilt sensor is tilted in the requested direction.
     */
    isTilted (args) {
        const port = this._peripheral.findPort(DeviceType.TILT);
        if (!port) return false;
        const direction = tiltFromRaw(port.value);
        if (args.TILT_DIRECTION_ANY === TILT_ANY) {
            return direction !== TiltDirection.NONE;
        }
        return direction === args.TILT_DIRECTION_ANY;
    }

    /**
     * @param {object} args - the block's arguments.
     * @returns {number} - the raw 0-255 value of the requested port.
     */
    getSensorValue (args) {
        const index = Cast.toString(args.PORT).toUpperCase() === Port.B ? 1 : 0;
        return this._peripheral.port(index).value;
    }

    /**
     * @param {string} motorID - a MOTOR_ID menu value.
     * @param {function(WeDo1Motor)} callback - called for each motor the menu value refers to.
     */
    _forEachMotor (motorID, callback) {
        let indices;
        switch (motorID) {
        case MotorLabel.A:
            indices = [0];
            break;
        case MotorLabel.B:
            indices = [1];
            break;
        case MotorLabel.ALL:
            indices = [0, 1];
            break;
        default:
            console.warn(`Invalid motor ID: ${motorID}`);
            indices = [];
            break;
        }
        indices.forEach(index => callback(this._peripheral.motor(index)));
    }

    /**
     * @returns {Promise} - resolves after a short delay.
     */
    _commandDelay () {
        return new Promise(resolve => setTimeout(resolve, COMMAND_DELAY_MS));
    }
}

export {ExtensionBlocks as default, ExtensionBlocks as blockClass};
