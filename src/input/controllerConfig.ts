/*
 * Tuning for the tilt controller (ESP32 + MPU-6050).
 * Change these while testing; nothing else needs to change.
 */
export const CONTROLLER_CONFIG = {
  /** Must match Serial.begin(...) in the Arduino sketch. */
  BAUD_RATE: 115200,

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

  /** Back to mouse mode when no controller data arrived for this long (ms). */
  TIMEOUT_MS: 500,
} as const;
