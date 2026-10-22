/** Lexically normalizes a filesystem path for comparison (no filesystem access). */
export function normalizePath(path: string): string {
  const unified = path.trim().replace(/\\/g, '/');
  const collapsed = unified.replace(/(?<!^)\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

/** True for POSIX absolute, Windows drive-absolute, and UNC paths. */
export function isAbsolutePath(path: string): boolean {
  return /^(\/|[a-zA-Z]:[\\/]|\\\\|\/\/)/.test(path.trim());
}

/**
 * Compares paths case-insensitively. Treating case-variants as equal is the safe
 * choice: it can only produce false "same graph" positives, never a missed collision.
 */
export function isSamePath(a: string, b: string): boolean {
  return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
}

export function baseName(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}
