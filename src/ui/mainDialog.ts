import type { GraphRef, MigrationReport } from '../model/types';
import {
  VALIDATION_MESSAGES,
  createSelectionState,
  setFilter,
  setTargetPath,
  togglePage,
  validateSelection,
  visiblePages,
  type PageOption,
  type SelectionState,
} from './selectionModel';

export interface MainDialogDeps {
  loadPages(): Promise<PageOption[]>;
  getSourceGraph(): Promise<GraphRef | null>;
  submit(state: SelectionState, sourceGraph: GraphRef): Promise<MigrationReport>;
  close(): void;
}

/** Thin DOM view over the selection model. All text is set via textContent (no HTML injection). */
export class MainDialog {
  private state: SelectionState = createSelectionState([]);
  private sourceGraph: GraphRef | null = null;
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly deps: MainDialogDeps,
  ) {}

  async open(preselected: readonly string[] = []): Promise<void> {
    this.root.replaceChildren(el('div', 'gs-panel', 'Loading pages…'));
    const [pages, sourceGraph] = await Promise.all([this.deps.loadPages(), this.deps.getSourceGraph()]);
    this.sourceGraph = sourceGraph;
    this.state = createSelectionState(pages, preselected);
    this.busy = false;
    this.render();
  }

  private update(next: SelectionState, rerenderList: boolean): void {
    this.state = next;
    if (rerenderList) {
      this.renderPageList();
    }
    this.renderStatus();
  }

  private render(): void {
    const panel = el('div', 'gs-panel');

    const header = el('div', 'gs-header');
    header.append(el('h2', '', 'Graph Splitter'), this.button('×', 'gs-close', () => this.deps.close()));

    const source = el('p', 'gs-muted', `Source graph: ${this.sourceGraph?.path ?? '(none)'}`);

    const filter = document.createElement('input');
    filter.type = 'search';
    filter.placeholder = 'Filter pages…';
    filter.className = 'gs-input';
    filter.addEventListener('input', () => this.update(setFilter(this.state, filter.value), true));

    const list = el('div', 'gs-list');
    list.id = 'gs-page-list';

    const target = document.createElement('input');
    target.type = 'text';
    target.placeholder = 'Absolute path of target graph folder (created if missing)';
    target.className = 'gs-input';
    target.addEventListener('input', () => this.update(setTargetPath(this.state, target.value), false));

    const status = el('div', 'gs-status');
    status.id = 'gs-status';

    const actions = el('div', 'gs-actions');
    const moveButton = this.button('Move pages', 'gs-primary', () => void this.onSubmit());
    moveButton.id = 'gs-submit';
    actions.append(this.button('Cancel', '', () => this.deps.close()), moveButton);

    panel.append(header, source, filter, list, labelled('Target graph folder', target), status, actions);
    this.root.replaceChildren(panel);
    this.renderPageList();
    this.renderStatus();
  }

  private renderPageList(): void {
    const list = this.root.querySelector<HTMLElement>('#gs-page-list');
    if (list === null) {
      return;
    }
    const rows = visiblePages(this.state).map((page) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = this.state.selected.has(page.name);
      checkbox.addEventListener('change', () => this.update(togglePage(this.state, page.name), false));
      const row = document.createElement('label');
      row.className = 'gs-row';
      row.append(checkbox, document.createTextNode(page.name));
      return row;
    });
    list.replaceChildren(...(rows.length > 0 ? rows : [el('p', 'gs-muted', 'No movable pages found.')]));
  }

  private renderStatus(message?: string): void {
    const status = this.root.querySelector<HTMLElement>('#gs-status');
    const submit = this.root.querySelector<HTMLButtonElement>('#gs-submit');
    const errors = validateSelection(this.state, this.sourceGraph);
    if (status !== null) {
      const lines = message !== undefined ? [message] : errors.map((e) => VALIDATION_MESSAGES[e]);
      status.replaceChildren(
        el('p', 'gs-muted', `${this.state.selected.size} page(s) selected`),
        ...lines.map((line) => el('p', '', line)),
      );
    }
    if (submit !== null) {
      submit.disabled = this.busy || errors.length > 0;
    }
  }

  private async onSubmit(): Promise<void> {
    if (this.busy || this.sourceGraph === null) {
      return;
    }
    this.busy = true;
    this.renderStatus('Migration in progress…');
    try {
      const report = await this.deps.submit(this.state, this.sourceGraph);
      this.renderStatus(`Migration ${report.status}. ${report.errors.join(' ')}`.trim());
    } catch (error) {
      this.renderStatus(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy = false;
    }
  }

  private button(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `gs-button ${className}`.trim();
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'gs-field';
  label.append(el('span', '', text), control);
  return label;
}
