import { describe, expect, it } from 'vitest';
import { FileAlreadyExistsError, decodeText, encodeText, readText } from '../src/fs/fileSystem';
import { sha256Hex } from '../src/fs/hash';
import { joinPath, parentPath, splitExtension } from '../src/fs/paths';
import { createUnavailableFileSystem } from '../src/fs/unavailableFileSystem';
import { MemoryFileSystem } from './support/memoryFileSystem';

describe('fileSystem helpers', () => {
  it('round-trips text including a BOM', () => {
    const text = '\uFEFFhéllo ✓';
    expect(decodeText(encodeText(text))).toBe(text);
  });

  it('rejects invalid UTF-8', () => {
    expect(() => decodeText(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow();
  });

  it('hashes bytes and strings identically', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(encodeText('abc'))).toBe(await sha256Hex('abc'));
  });

  it('joins and splits paths', () => {
    expect(joinPath('/g/A', 'pages', 'x.md')).toBe('/g/A/pages/x.md');
    expect(joinPath('C:\\g\\A\\', 'logseq/bak')).toBe('C:/g/A/logseq/bak');
    expect(parentPath('/g/A/x.md')).toBe('/g/A');
    expect(parentPath('/g')).toBe('/');
    expect(parentPath('x')).toBe('');
    expect(splitExtension('photo.final.png')).toEqual({ stem: 'photo.final', ext: '.png' });
    expect(splitExtension('.hidden')).toEqual({ stem: '.hidden', ext: '' });
  });

  it('unavailable filesystem fails every call', async () => {
    await expect(createUnavailableFileSystem().exists('/x')).rejects.toThrow(/not available/);
  });
});

describe('MemoryFileSystem', () => {
  it('creates directories recursively and lists children', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/g/A/pages');
    await fs.writeBytes('/g/A/pages/x.md', encodeText('x'), { overwrite: false });
    expect(await fs.readDir('/g/A')).toEqual(['pages']);
    expect(await fs.readDir('/g/A/pages')).toEqual(['x.md']);
    expect(await readText(fs, '/g/A/pages/x.md')).toBe('x');
  });

  it('refuses to overwrite unless asked and requires a parent directory', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d');
    await fs.writeBytes('/d/f', encodeText('1'), { overwrite: false });
    await expect(fs.writeBytes('/d/f', encodeText('2'), { overwrite: false })).rejects.toBeInstanceOf(FileAlreadyExistsError);
    await fs.writeBytes('/d/f', encodeText('2'), { overwrite: true });
    expect(fs.text('/d/f')).toBe('2');
    await expect(fs.writeBytes('/missing/f', encodeText(''), { overwrite: false })).rejects.toThrow(/ENOENT/);
  });

  it('treats paths case-insensitively when configured', async () => {
    const fs = new MemoryFileSystem(false);
    await fs.mkdir('/d');
    await fs.writeBytes('/d/Image.png', encodeText('a'), { overwrite: false });
    expect(await fs.exists('/D/image.PNG')).toBe(true);
    await expect(fs.writeBytes('/d/image.png', encodeText('b'), { overwrite: false })).rejects.toBeInstanceOf(FileAlreadyExistsError);
    expect(await fs.readDir('/d')).toEqual(['Image.png']);
  });

  it('honours read-only files and injected failures', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/d');
    await fs.writeBytes('/d/f', encodeText('1'), { overwrite: false });
    fs.setReadOnly('/d/f');
    await expect(fs.writeBytes('/d/f', encodeText('2'), { overwrite: true })).rejects.toThrow(/EACCES/);
    await expect(fs.remove('/d/f')).rejects.toThrow(/EACCES/);
    fs.setReadOnly('/d/f', false);
    fs.failOn = (op) => op === 'remove';
    await expect(fs.remove('/d/f')).rejects.toThrow(/Simulated/);
    fs.failOn = undefined;
    await fs.remove('/d/f');
    expect(fs.has('/d/f')).toBe(false);
    await expect(fs.remove('/d')).rejects.toThrow(/EISDIR/);
  });
});
