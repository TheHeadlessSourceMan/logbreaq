export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly prefix = '[graph-splitter]') {}

  debug(message: string, data?: unknown): void {
    console.debug(this.prefix, message, data ?? '');
  }

  info(message: string, data?: unknown): void {
    console.info(this.prefix, message, data ?? '');
  }

  warn(message: string, data?: unknown): void {
    console.warn(this.prefix, message, data ?? '');
  }

  error(message: string, data?: unknown): void {
    console.error(this.prefix, message, data ?? '');
  }
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
