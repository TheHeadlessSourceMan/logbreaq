import type { FileSystem } from './fileSystem';

/** Used until a platform filesystem adapter exists: every operation fails, so migrations abort at step 1. */
export function createUnavailableFileSystem(): FileSystem {
  const fail = async (): Promise<never> => {
    throw new Error('Graph Splitter: filesystem access is not available in this environment yet.');
  };
  return { exists: fail, isDirectory: fail, readDir: fail, readBytes: fail, writeBytes: fail, mkdir: fail, remove: fail };
}
