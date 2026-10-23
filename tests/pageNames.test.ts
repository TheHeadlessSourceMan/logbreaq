import { describe, expect, it } from 'vitest';
import { formatJournalTitle, parseJournalFileName } from '../src/parsing/journalTitles';
import { fileNameToPageName, pageKey, pageNameToFileName } from '../src/parsing/pageNames';
import { extractPageProperties, parsePropertyValues, replaceTitleProperty } from '../src/parsing/pageProperties';

describe('pageNames', () => {
  it('normalizes keys for case and unicode composition', () => {
    expect(pageKey('  Café ')).toBe(pageKey('Cafe\u0301'));
    expect(pageKey('Project A')).toBe('project a');
  });

  it.each([
    ['Simple', 'Simple.md'],
    ['With spaces, commas.', 'With spaces, commas%2E.md'],
    ['Namespace/Child/Leaf', 'Namespace___Child___Leaf.md'],
    ['Q: what? <a|b> "x" * 50% #1', 'Q%3A what%3F %3Ca%7Cb%3E %22x%22 %2A 50%25 %231.md'],
    ['Ünïcödé 日本語', 'Ünïcödé 日本語.md'],
    ['v1.2', 'v1.2.md'],
  ])('maps %j to a file name and back', (name, fileName) => {
    expect(pageNameToFileName(name)).toBe(fileName);
    expect(fileNameToPageName(fileName)).toBe(name);
  });

  it('does not decode multi-byte percent sequences', () => {
    expect(fileNameToPageName('a%E2%9C%93.md')).toBe('a%E2%9C%93');
  });
});

describe('pageProperties', () => {
  it('reads leading properties only', () => {
    const props = extractPageProperties('title:: My Page\nAlias:: a, b\n\n- body:: not a page property');
    expect([...props]).toEqual([['title', 'My Page'], ['alias', 'a, b']]);
  });

  it('accepts empty values', () => {
    expect(extractPageProperties('tags::\n- x').get('tags')).toBe('');
  });

  it('handles a leading byte-order mark', () => {
    expect(extractPageProperties('\uFEFFtitle:: T\n').get('title')).toBe('T');
    expect(replaceTitleProperty('\uFEFFtitle:: T\n- x', 'U')).toBe('\uFEFFtitle:: U\n- x');
  });

  it('splits property values, respecting bracketed names with commas', () => {
    expect(parsePropertyValues('a, [[b, c]], #d,  ')).toEqual(['a', 'b, c', 'd']);
  });

  it('replaces the title property preserving line endings', () => {
    expect(replaceTitleProperty('alias:: x\r\ntitle:: Old\r\n- body', 'New')).toBe('alias:: x\r\ntitle:: New\r\n- body');
    expect(replaceTitleProperty('- title:: in a block', 'New')).toBe('- title:: in a block');
  });
});

describe('journalTitles', () => {
  it('parses valid journal file names only', () => {
    expect(parseJournalFileName('2026_10_22.md')).toEqual({ year: 2026, month: 10, day: 22 });
    expect(parseJournalFileName('2026_02_30.md')).toBeUndefined();
    expect(parseJournalFileName('notes.md')).toBeUndefined();
  });

  it('formats the default Logseq title and other tokens', () => {
    const date = { year: 2026, month: 10, day: 22 };
    expect(formatJournalTitle(date, 'MMM do, yyyy')).toBe('Oct 22nd, 2026');
    expect(formatJournalTitle(date, 'EEEE, dd.MM.yyyy')).toBe('Thursday, 22.10.2026');
    expect(formatJournalTitle(date, 'yyyy-M-d EEE MMMM yy')).toBe('2026-10-22 Thu October 26');
    expect(formatJournalTitle({ year: 2026, month: 1, day: 11 }, 'do')).toBe('11th');
    expect(formatJournalTitle({ year: 2026, month: 1, day: 1 }, 'do')).toBe('1st');
    expect(formatJournalTitle({ year: 2026, month: 1, day: 23 }, 'do')).toBe('23rd');
  });
});
