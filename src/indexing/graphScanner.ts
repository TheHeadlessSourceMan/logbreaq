import { decodeText, type FileSystem } from '../fs/fileSystem';
import { sha256Hex } from '../fs/hash';
import { joinPath, normalizePath } from '../fs/paths';
import type { GraphLayout, GraphRef } from '../model/types';
import { formatJournalTitle, parseJournalFileName } from '../parsing/journalTitles';
import { fileNameToPageName, pageKey } from '../parsing/pageNames';
import { parsePage, type PageNode } from '../parsing/pageParser';
import { extractPageProperties, parsePropertyValues } from '../parsing/pageProperties';

export type PageFolder = 'pages' | 'journals';

export interface PageFile {
  readonly name: string;
  readonly key: string;
  readonly graphId: string;
  readonly folder: PageFolder;
  readonly fileName: string;
  readonly filePath: string;
  readonly content: string;
  readonly sha256: string;
  readonly aliases: readonly string[];
  readonly nodes: readonly PageNode[];
}

export interface ScannedGraph {
  readonly graph: GraphRef;
  readonly id: string;
  /** Page key -> page. */
  readonly pages: ReadonlyMap<string, PageFile>;
  /** Alias key -> page key. Never shadows a real page. */
  readonly aliases: ReadonlyMap<string, string>;
  /** Groups of files that map to the same page key (all members included). */
  readonly duplicates: readonly (readonly PageFile[])[];
  /** Files in page folders that are not Markdown (e.g. .org); never processed. */
  readonly unsupportedFiles: readonly string[];
}

export function graphId(path: string): string {
  return normalizePath(path).toLowerCase();
}

function defaultPageName(folder: PageFolder, fileName: string, layout: GraphLayout): string {
  if (folder === 'journals') {
    const date = parseJournalFileName(fileName);
    if (date !== undefined) {
      return formatJournalTitle(date, layout.journalTitleFormat);
    }
  }
  return fileNameToPageName(fileName);
}

/** Reads every Markdown page of a graph. Read-only. */
export async function scanGraph(fs: FileSystem, graph: GraphRef, layout: GraphLayout): Promise<ScannedGraph> {
  const id = graphId(graph.path);
  const pages = new Map<string, PageFile>();
  const duplicateGroups = new Map<string, PageFile[]>();
  const unsupportedFiles: string[] = [];

  for (const folder of ['pages', 'journals'] as const) {
    const dir = joinPath(graph.path, folder === 'pages' ? layout.pagesDir : layout.journalsDir);
    if (!(await fs.isDirectory(dir))) {
      continue;
    }
    for (const fileName of (await fs.readDir(dir)).sort()) {
      const filePath = joinPath(dir, fileName);
      if (await fs.isDirectory(filePath)) {
        continue;
      }
      if (!/\.md$/i.test(fileName)) {
        unsupportedFiles.push(filePath);
        continue;
      }
      const bytes = await fs.readBytes(filePath);
      const content = decodeText(bytes);
      const properties = extractPageProperties(content);
      const title = properties.get('title');
      const name = title !== undefined && title !== '' ? title : defaultPageName(folder, fileName, layout);
      const page: PageFile = {
        name,
        key: pageKey(name),
        graphId: id,
        folder,
        fileName,
        filePath,
        content,
        sha256: await sha256Hex(bytes),
        aliases: parsePropertyValues(properties.get('alias') ?? ''),
        nodes: parsePage(content).nodes,
      };
      const existing = pages.get(page.key);
      if (existing === undefined) {
        pages.set(page.key, page);
      } else {
        const group = duplicateGroups.get(page.key) ?? [existing];
        group.push(page);
        duplicateGroups.set(page.key, group);
      }
    }
  }

  const aliases = new Map<string, string>();
  for (const page of pages.values()) {
    for (const alias of page.aliases) {
      const key = pageKey(alias);
      if (!pages.has(key) && !aliases.has(key)) {
        aliases.set(key, page.key);
      }
    }
  }

  return { graph, id, pages, aliases, duplicates: [...duplicateGroups.values()], unsupportedFiles };
}

/** Resolves a page name or alias to the canonical page key of a graph. */
export function resolvePageKey(graph: ScannedGraph, name: string): string | undefined {
  const key = pageKey(name);
  return graph.pages.has(key) ? key : graph.aliases.get(key);
}
