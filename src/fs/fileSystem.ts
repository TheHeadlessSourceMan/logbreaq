export interface WriteOptions {
  /** When false, the write must fail if the file already exists. */
  readonly overwrite: boolean;
}

/**
 * Minimal filesystem abstraction used by every migration step.
 * All paths are absolute and use '/' separators.
 */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  /** Names (not paths) of the direct children of a directory. */
  readDir(path: string): Promise<string[]>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array, options: WriteOptions): Promise<void>;
  /** Recursive; succeeds if the directory already exists. */
  mkdir(path: string): Promise<void>;
  /** Removes a single file. Never removes directories. */
  remove(path: string): Promise<void>;
}

export class FileAlreadyExistsError extends Error {
  constructor(readonly path: string) {
    super(`File already exists: ${path}`);
    this.name = 'FileAlreadyExistsError';
  }
}

const encoder = new TextEncoder();

export function encodeText(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Strict UTF-8 decoding that keeps a BOM, so decode/encode round-trips byte-for-byte. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

export async function readText(fs: FileSystem, path: string): Promise<string> {
  return decodeText(await fs.readBytes(path));
}
