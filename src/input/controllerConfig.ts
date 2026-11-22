/*
 * Tuning for the tilt controller (ESP32 + MPU-6050).
 * Change these while testing; nothing else needs to change.
 */
export const CONTROLLER_CONFIG = {
  /** Must match Serial.begin(...) in the Arduino sketch. */
  BAUD_RATE: 115200,

  /**
   * How the controller moves the cursor:
   * - 'point': absolute, like a Wii remote. Where you point is where the cursor goes.
   * - 'rate':  like a joystick. Tilting sets the speed of the cursor.
   */
  CONTROL_MODE: 'point' as 'point' | 'rate',

  /** Back to mouse mode when no controller data arrived for this long (ms). */
  TIMEOUT_MS: 500,

  /** Settings for CONTROL_MODE 'point'. */
  POINT: {
    /** Which tilt angle is up/down: 'x' or 'y'. Left/right always comes from z (the gyro). */
    PITCH_AXIS: 'x' as 'x' | 'y',
    /** Flip up/down or left/right if the cursor goes the wrong way. */
    INVERT_PITCH: false,
    INVERT_YAW: true,
    /** Degrees from the center to the left/right edge of the screen. */
    YAW_RANGE: 45,
    /** Degrees from the center to the top/bottom edge of the screen. */
    PITCH_RANGE: 35,
    /** Smoothing time in seconds: higher = calmer but slower to follow, 0 = none. */
    SMOOTHING: 0.08,
    /** Movements smaller than this (degrees) are ignored, against jitter. */
    DEAD_ZONE: 1,
  },

  /** Recentering at the start of a minigame ("point at the star"). */
  RECENTER: {
    /** Text above the star. */
    TEXT: 'Wijs naar de ster!',
    /** How long the controller must be held still (ms). */
    STILL_TIME: 1000,
    /** "Still" = pitch and yaw stay within this many degrees during STILL_TIME. */
    STILL_TOLERANCE: 2.5,
  },

  /** Settings for CONTROL_MODE 'rate'. */
  RATE: {
    /** Tilt (degrees) around the neutral position that is ignored. */
    DEAD_ZONE: 4,
    /** Tilt (degrees) at which the cursor reaches MAX_SPEED. */
    MAX_ANGLE: 30,
    /** Cursor speed at full tilt, in game pixels per second (the game is 1920 x 1280). */
    MAX_SPEED: 1400,
    /** Smoothing time in seconds: higher = smoother but slower to react, 0 = no smoothing. */
    SMOOTHING: 0.12,
    /**
     * Axis mapping. Default: sensor y (tilt left/right) moves the cursor left/right,
     * sensor x (tilt forward/back) moves it up/down.
     * SWAP_AXES swaps them; INVERT_X / INVERT_Y flip a direction (applied after swapping).
     */
    SWAP_AXES: false,
    INVERT_X: false,
    INVERT_Y: false,
  },
};
