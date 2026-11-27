/*
 * One controller on one serial port: reads lines of JSON and hands them on.
 * A second controller simply gets its own SerialController (its own port).
 */

export type ControllerMessage = Record<string, unknown>;

interface Handlers {
  onMessage(message: ControllerMessage): void;
  /** Called once when the port is closed: unplugged, read error or close(). */
  onClose(): void;
}

/** Lines longer than this without a newline are junk; drop them. */
const MAX_BUFFER = 4096;

export class SerialController {
  /**
   * Which player each "p" in this port's messages is (set by the InputManager). One port can send
   * both players (one ESP32 with two sensors); usually p stays p, see InputManager.playerFor.
   */
  readonly players = new Map<number, 1 | 2>();
  private reader?: ReadableStreamDefaultReader<string>;
  private closing = false;

  constructor(
    readonly port: SerialPort,
    private readonly handlers: Handlers,
  ) {}

  async open(baudRate: number) {
    await this.port.open({ baudRate });
    void this.readLoop();
  }

  /** Stop reading and close the port. Safe to call more than once. */
  async close() {
    this.closing = true;
    try {
      await this.reader?.cancel();
    } catch {
      // Already closed.
    }
  }

  private async readLoop() {
    const readable = this.port.readable;
    if (!readable) {
      this.handlers.onClose();
      return;
    }

    const decoder = new TextDecoderStream();
    const piped = readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => {
      // Ends with an error when the cable is pulled or we cancel: that's expected.
    });
    const reader = decoder.readable.getReader();
    this.reader = reader;
    let buffer = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;

        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) this.parse(line);
        }
        if (buffer.length > MAX_BUFFER) buffer = '';
      }
    } catch (error) {
      // Unplugging the controller ends up here.
      if (!this.closing) console.warn('[controller] read stopped:', error);
    } finally {
      reader.releaseLock();
      await piped;
      try {
        await this.port.close();
      } catch {
        // Port is already gone (unplugged).
      }
      this.handlers.onClose();
    }
  }

  private parse(line: string) {
    try {
      const message: unknown = JSON.parse(line);
      if (message && typeof message === 'object') this.handlers.onMessage(message as ControllerMessage);
    } catch {
      // Half or broken line (e.g. right after connecting): skip it.
    }
  }
}
