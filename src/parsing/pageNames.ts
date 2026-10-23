/** Logseq page names are case-insensitive; this is the identity used for lookups. */
export function pageKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

const RESERVED_FILE_CHARS = /[<>:"\\|?*%#]/g;

/** Logseq `:triple-lowbar` file naming: `/` becomes `___`, reserved characters are percent-encoded. */
export function pageNameToFileName(name: string): string {
  const encoded = name
    .trim()
    .replace(RESERVED_FILE_CHARS, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
    .replace(/\//g, '___');
  // Windows forbids trailing dots and spaces in file names.
  return `${encoded.replace(/[. ]$/, (c) => (c === '.' ? '%2E' : '%20'))}.md`;
}

export function fileNameToPageName(fileName: string): string {
  return fileName
    .replace(/\.md$/i, '')
    .replace(/___/g, '/')
    .replace(/%([0-7][0-9A-Fa-f])/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
