import '@logseq/libs';
import type { PageEntity } from '@logseq/libs/dist/LSPlugin';
import './ui/styles.css';
import { createUnavailableFileSystem } from './fs/unavailableFileSystem';
import { ConsoleLogger } from './logging/logger';
import { buildMigrationRequest } from './migration/migrationRequest';
import { runMigration } from './migration/migrationWorkflow';
import type { MigrationDependencies } from './migration/migrationContext';
import type { GraphRef } from './model/types';
import { LogseqUrlLinkRenderer } from './rendering/linkRenderer';
import { createDialogConflictResolver } from './ui/dialogConflictResolver';
import { MainDialog } from './ui/mainDialog';
import type { PageOption } from './ui/selectionModel';

const OPEN_MODEL_ACTION = 'openGraphSplitter';

async function loadPages(): Promise<PageOption[]> {
  const pages: PageEntity[] = (await logseq.Editor.getAllPages()) ?? [];
  return pages.map((page) => ({
    name: page.originalName ?? page.name,
    isJournal: page['journal?'] === true,
    hasFile: page.file !== undefined && page.file !== null,
  }));
}

async function getSourceGraph(): Promise<GraphRef | null> {
  const graph = await logseq.App.getCurrentGraph();
  return graph?.path ? { name: graph.name, path: graph.path } : null;
}

function main(): void {
  const logger = new ConsoleLogger();
  const root = document.getElementById('app');
  if (root === null) {
    throw new Error('Graph Splitter: #app root element missing');
  }

  const deps: MigrationDependencies = {
    fs: createUnavailableFileSystem(),
    logger,
    linkRenderer: new LogseqUrlLinkRenderer(),
    conflictResolver: createDialogConflictResolver(),
    now: () => Date.now(),
  };

  const close = (): void => logseq.hideMainUI({ restoreEditingCursor: true });

  const dialog = new MainDialog(root, {
    loadPages,
    getSourceGraph,
    close,
    async submit(state, sourceGraph) {
      const request = buildMigrationRequest(state, sourceGraph, { id: crypto.randomUUID(), now: new Date() });
      const report = await runMigration(request, deps);
      const level = report.status === 'succeeded' ? 'success' : 'error';
      await logseq.UI.showMsg(`Graph Splitter: migration ${report.status}`, level);
      return report;
    },
  });

  const open = (preselected: readonly string[] = []): void => {
    logseq.showMainUI({ autoFocus: true });
    dialog.open(preselected).catch((error: unknown) => logger.error('Failed to open dialog', error));
  };

  logseq.provideModel({ [OPEN_MODEL_ACTION]: () => open() });

  logseq.App.registerUIItem('toolbar', {
    key: 'graph-splitter',
    template: `<a class="button" data-on-click="${OPEN_MODEL_ACTION}" title="Graph Splitter: move pages to another graph"><i class="ti ti-arrows-split"></i></a>`,
  });

  logseq.App.registerCommandPalette(
    { key: 'graph-splitter-open', label: 'Graph Splitter: Move pages to another graph' },
    () => open(),
  );

  logseq.App.registerPageMenuItem('Graph Splitter: Move this page to another graph', ({ page }) => open([page]));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });
  root.addEventListener('click', (event) => {
    if (event.target === root) {
      close();
    }
  });

  logger.info('Graph Splitter loaded');
}

logseq.ready(main).catch(console.error);
