import {blockClass} from '../../src/vm/extensions/block/index.js';
import {
    DeviceType,
    TiltDirection,
    deviceTypeFromId,
    tiltFromRaw,
    distanceFromRaw,
    powerToPwm,
    encodeMotorCommand,
    decodeInputReport
} from '../../src/vm/extensions/block/protocol.js';

const makeFormatMessage = () => {
    const formatMessage = msg => msg.default;
    formatMessage.setup = () => ({locale: 'en', translations: {en: {}}});
    return formatMessage;
};

const makeRuntime = () => ({
    formatMessage: makeFormatMessage(),
    registerPeripheralExtension: () => {},
    on: () => {}
});

describe('blockClass', () => {
    test('creates an instance and reports its blocks', () => {
        const block = new blockClass(makeRuntime());
        expect(block).toBeInstanceOf(blockClass);
        const info = block.getInfo();
        expect(info.id).toBe('wedo1');
        expect(info.showStatusButton).toBe(true);
    });

    test('sensor blocks return defaults when no hub is connected', () => {
        const block = new blockClass(makeRuntime());
        expect(block.getDistance()).toBe(0);
        expect(block.whenDistance({OP: '<', REFERENCE: 50})).toBe(false);
        expect(block.isTilted({TILT_DIRECTION_ANY: 'any'})).toBe(false);
        expect(block.getSensorValue({PORT: 'B'})).toBe(0);
    });
});

describe('protocol', () => {
    test('deviceTypeFromId', () => {
        expect(deviceTypeFromId(0)).toBe(DeviceType.MOTOR);
        expect(deviceTypeFromId(38)).toBe(DeviceType.TILT);
        expect(deviceTypeFromId(177)).toBe(DeviceType.DISTANCE);
        // Measured on a real 9581 hub with nothing plugged in: IDs alternate between 230 and 231.
        expect(deviceTypeFromId(230)).toBe(DeviceType.NONE);
        expect(deviceTypeFromId(231)).toBe(DeviceType.NONE);
        expect(deviceTypeFromId(100)).toBe(DeviceType.UNKNOWN);
    });

    test('tiltFromRaw', () => {
        expect(tiltFromRaw(0)).toBe(TiltDirection.DOWN);
        expect(tiltFromRaw(75)).toBe(TiltDirection.RIGHT);
        expect(tiltFromRaw(128)).toBe(TiltDirection.NONE);
        expect(tiltFromRaw(180)).toBe(TiltDirection.UP);
        expect(tiltFromRaw(255)).toBe(TiltDirection.LEFT);
    });

    test('distanceFromRaw clamps to [0,100]', () => {
        expect(distanceFromRaw(0)).toBe(100);
        expect(distanceFromRaw(255)).toBe(0);
    });

    test('powerToPwm', () => {
        expect(powerToPwm(0, 1)).toBe(0);
        expect(powerToPwm(100, 1)).toBe(127);
        expect(powerToPwm(100, -1)).toBe(-127);
        expect(powerToPwm(1, 1)).toBeGreaterThan(27);
    });

    test('encodeMotorCommand', () => {
        expect(Array.from(encodeMotorCommand(127, -127))).toEqual([0x40, 127, 129, 0, 0, 0, 0, 0]);
    });

    test('decodeInputReport matches a report captured from a real hub', () => {
        const data = new DataView(new Uint8Array([0x40, 0x69, 0xf3, 0xe6, 0xf3, 0xe7, 0x00, 0x00]).buffer);
        expect(decodeInputReport(data)).toEqual([
            {value: 243, id: 230},
            {value: 243, id: 231}
        ]);
    });
});
