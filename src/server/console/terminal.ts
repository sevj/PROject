/** A program attached to a terminal, wherever it runs. */
export type Terminal = {
  write(data: Buffer): void;
  /** Best effort: a program that has just ended cannot be resized, and that is fine. */
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  onData(listener: (data: Buffer) => void): void;
  /** When the program ends by itself, not when it is stopped. */
  onExit(listener: (code: number | null) => void): void;
  /** The browser is gone: what it was running must not outlive it. */
  stop(): void;
};
