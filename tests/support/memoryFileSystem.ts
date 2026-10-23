import { FileAlreadyExistsError, decodeText, type FileSystem, type WriteOptions } from '../../src/fs/fileSystem';
import { baseName, normalizePath, parentPath } from '../../src/fs/paths';

export type Operation = 'read' | 'write' | 'mkdir' | 'remove' | 'readDir';

interface Entry {
  readonly path: string;
  /** null marks a directory. */
  readonly data: Uint8Array | null;
}

/** In-memory filesystem for tests, optionally case-insensitive, with failure injection. */
export class MemoryFileSystem implements FileSystem {
  private readonly entries = new Map<string, Entry>();
  private readonly readOnly = new Set<string>();
  failOn: ((op: Operation, path: string) => boolean) | undefined;

  constructor(readonly caseSensitive = true) {}

  setReadOnly(path: string, readOnly = true): void {
    if (readOnly) {
      this.readOnly.add(this.key(path));
    } else {
      this.readOnly.delete(this.key(path));
    }
  }

  async exists(path: string): Promise<boolean> {
    return isRoot(path) || this.entries.has(this.key(path));
  }

  async isDirectory(path: string): Promise<boolean> {
    return isRoot(path) || this.entries.get(this.key(path))?.data === null;
  }

  async readDir(path: string): Promise<string[]> {
    this.check('readDir', path);
    if (!(await this.isDirectory(path))) {
      throw new Error(`ENOTDIR: ${path}`);
    }
    const dirKey = this.key(path);
    return [...this.entries.values()]
      .filter((e) => this.key(parentPath(e.path)) === dirKey)
      .map((e) => baseName(e.path))
      .sort();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    this.check('read', path);
    const entry = this.entries.get(this.key(path));
    if (entry === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    if (entry.data === null) {
      throw new Error(`EISDIR: ${path}`);
    }
    return entry.data.slice();
  }

  async writeBytes(path: string, data: Uint8Array, options: WriteOptions): Promise<void> {
    this.check('write', path);
    const key = this.key(path);
    if (this.readOnly.has(key)) {
      throw new Error(`EACCES: ${path}`);
    }
    if (!(await this.isDirectory(parentPath(path)))) {
      throw new Error(`ENOENT: parent of ${path}`);
    }
    const existing = this.entries.get(key);
    if (existing?.data === null) {
      throw new Error(`EISDIR: ${path}`);
    }
    if (existing !== undefined && !options.overwrite) {
      throw new FileAlreadyExistsError(path);
    }
    this.entries.set(key, { path: existing?.path ?? normalizePath(path), data: data.slice() });
  }

  async mkdir(path: string): Promise<void> {
    this.check('mkdir', path);
    for (const dir of ancestors(normalizePath(path))) {
      if (isRoot(dir)) {
        continue;
      }
      const existing = this.entries.get(this.key(dir));
      if (existing === undefined) {
        this.entries.set(this.key(dir), { path: dir, data: null });
      } else if (existing.data !== null) {
        throw new Error(`EEXIST (file): ${dir}`);
      }
    }
  }

  async remove(path: string): Promise<void> {
    this.check('remove', path);
    const key = this.key(path);
    if (this.readOnly.has(key)) {
      throw new Error(`EACCES: ${path}`);
    }
    const entry = this.entries.get(key);
    if (entry === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    if (entry.data === null) {
      throw new Error(`EISDIR: ${path}`);
    }
    this.entries.delete(key);
  }

  /** Synchronous test helper. */
  text(path: string): string {
    const entry = this.entries.get(this.key(path));
    if (entry?.data == null) {
      throw new Error(`No file: ${path}`);
    }
    return decodeText(entry.data);
  }

  has(path: string): boolean {
    return this.entries.has(this.key(path));
  }

  /** All file paths under a directory (recursive), sorted. */
  filesUnder(dir: string): string[] {
    const prefix = `${this.key(dir)}/`;
    return [...this.entries.entries()]
      .filter(([k, e]) => e.data !== null && k.startsWith(prefix))
      .map(([, e]) => e.path)
      .sort();
  }

  private key(path: string): string {
    const normalized = normalizePath(path);
    return this.caseSensitive ? normalized : normalized.toLowerCase();
  }

  private check(op: Operation, path: string): void {
    if (this.failOn?.(op, normalizePath(path)) === true) {
      throw new Error(`Simulated ${op} failure: ${path}`);
    }
  }
}

function isRoot(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === '' || normalized === '/' || /^[a-zA-Z]:$/.test(normalized);
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  let index = path.indexOf('/', 1);
  while (index !== -1) {
    result.push(path.slice(0, index));
    index = path.indexOf('/', index + 1);
  }
  result.push(path);
  return result;
}
