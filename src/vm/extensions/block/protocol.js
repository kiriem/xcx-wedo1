/**
 * Wire protocol for the LEGO WeDo 1.0 USB hub (USB HID, VID 0x0694 / PID 0x0003).
 *
 * The hub has two ports (A and B). Each port carries motor power out and an analog sensor reading back.
 *
 * Output report (8 bytes, no report ID):
 *   [0x40, motorA, motorB, 0, 0, 0, 0, 0]
 *   motorA / motorB are signed 8-bit PWM values. The motor does not turn below ~27, so the usable range is
 *   ±(28..127) and 0 means off.
 *
 * Input report (8 bytes, sent continuously by the hub):
 *   [status, supply, valueA, idA, valueB, idB, 0, 0]
 *   idX is the reading of the identification resistor of the device plugged into port X, and valueX is that
 *   device's analog value.
 */

export const VENDOR_ID = 0x0694;
export const PRODUCT_ID = 0x0003;

const MOTOR_COMMAND = 0x40;
const MOTOR_MIN_PWM = 27;
const MOTOR_MAX_PWM = 127;

/**
 * Kind of device detected on a port, derived from its identification byte.
 * @readonly
 * @enum {string}
 */
export const DeviceType = {
    NONE: 'none',
    MOTOR: 'motor',
    TILT: 'tilt',
    DISTANCE: 'distance',
    UNKNOWN: 'unknown'
};

/**
 * Discrete tilt positions reported by the WeDo 1.0 tilt sensor.
 * @readonly
 * @enum {string}
 */
export const TiltDirection = {
    NONE: 'none',
    UP: 'up',
    DOWN: 'down',
    LEFT: 'left',
    RIGHT: 'right'
};

/**
 * Identification byte ranges, inclusive. Each device's ID drifts by a few counts around its nominal value.
 * @type {Array<{min: number, max: number, type: DeviceType}>}
 */
const ID_RANGES = [
    {min: 0, max: 15, type: DeviceType.MOTOR},
    {min: 25, max: 50, type: DeviceType.TILT},
    {min: 165, max: 190, type: DeviceType.DISTANCE},
    {min: 225, max: 255, type: DeviceType.NONE}
];

/**
 * Raw tilt value bands, as upper bounds (exclusive), mapped to the tilt direction they represent.
 * @type {Array<{below: number, direction: TiltDirection}>}
 */
const TILT_BANDS = [
    {below: 49, direction: TiltDirection.DOWN},
    {below: 100, direction: TiltDirection.RIGHT},
    {below: 154, direction: TiltDirection.NONE},
    {below: 205, direction: TiltDirection.UP},
    {below: 256, direction: TiltDirection.LEFT}
];

// Measured on a real motion sensor (9583): it idles at 68 with nothing in front and peaks around 204-206 with a
// hand right against it.
/** Raw distance value when nothing is in front of the sensor. */
const DISTANCE_RAW_FAR = 68;
/** Raw distance value when an object is right against the sensor. */
const DISTANCE_RAW_NEAR = 205;

/**
 * @param {number} id - identification byte for a port.
 * @returns {DeviceType} - the kind of device plugged into that port.
 */
export const deviceTypeFromId = function (id) {
    const range = ID_RANGES.find(r => id >= r.min && id <= r.max);
    return range ? range.type : DeviceType.UNKNOWN;
};

/**
 * @param {number} value - raw tilt sensor value.
 * @returns {TiltDirection} - the tilt position.
 */
export const tiltFromRaw = function (value) {
    return TILT_BANDS.find(band => value < band.below).direction;
};

/**
 * @param {number} value - raw distance sensor value.
 * @returns {number} - distance scaled to [0,100], where 0 is touching and 100 is far away.
 */
export const distanceFromRaw = function (value) {
    const scaled = (DISTANCE_RAW_NEAR - value) * 100 / (DISTANCE_RAW_NEAR - DISTANCE_RAW_FAR);
    return Math.round(Math.max(0, Math.min(100, scaled)));
};

/**
 * @param {number} power - motor power in [0,100].
 * @param {number} direction - 1 or -1.
 * @returns {number} - signed PWM value in [-127,127].
 */
export const powerToPwm = function (power, direction) {
    if (power <= 0) return 0;
    const clamped = Math.min(100, power);
    const pwm = Math.round(MOTOR_MIN_PWM + (clamped * (MOTOR_MAX_PWM - MOTOR_MIN_PWM) / 100));
    return pwm * direction;
};

/**
 * @param {number} pwmA - signed PWM for port A.
 * @param {number} pwmB - signed PWM for port B.
 * @returns {Uint8Array} - output report payload.
 */
export const encodeMotorCommand = function (pwmA, pwmB) {
    return new Uint8Array([MOTOR_COMMAND, pwmA & 0xFF, pwmB & 0xFF, 0, 0, 0, 0, 0]);
};

/**
 * @param {DataView} data - input report payload.
 * @returns {Array<{id: number, value: number}>} - raw readings for ports A and B.
 */
export const decodeInputReport = function (data) {
    return [
        {value: data.getUint8(2), id: data.getUint8(3)},
        {value: data.getUint8(4), id: data.getUint8(5)}
    ];
};
