import { join } from 'node:path';
import type { CdpClient, CdpSession } from './client.ts';

export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
  disabled: boolean;
}

export interface SelectInfo {
  nodeRef: string;
  options: SelectOption[];
}

const SELECT_OF = `function () {
  var el = this.nodeType === 1 ? this : this.parentElement;
  return el && el.closest ? el.closest('select') : null;
}`;

const OPTIONS_OF = `function () {
  return Array.prototype.map.call(this.options, function (o) {
    return { value: o.value, label: o.label || o.text, selected: o.selected, disabled: o.disabled };
  });
}`;

const SET_VALUE = `function (v) {
  this.value = v;
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
}`;

async function nodeAt(session: CdpSession, x: number, y: number): Promise<string | undefined> {
  try {
    const { backendNodeId } = await session.send('DOM.getNodeForLocation', { x: Math.round(x), y: Math.round(y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: false });
    const { object } = await session.send('DOM.resolveNode', { backendNodeId });
    return object?.objectId;
  } catch {
    // fallback: elementFromPoint through Runtime.evaluate
    const r = await session.send('Runtime.evaluate', { expression: `document.elementFromPoint(${Number(x)}, ${Number(y)})` });
    return r.result?.objectId;
  }
}

/** The `<select>` under a point (CSS pixels), with its options, or null. */
export async function selectAt(session: CdpSession, x: number, y: number): Promise<SelectInfo | null> {
  const objectId = await nodeAt(session, x, y);
  if (!objectId) return null;
  const sel = await session.send('Runtime.callFunctionOn', { objectId, functionDeclaration: SELECT_OF });
  const nodeRef: string | undefined = sel.result?.objectId;
  if (!nodeRef) return null;
  const opts = await session.send('Runtime.callFunctionOn', { objectId: nodeRef, functionDeclaration: OPTIONS_OF, returnByValue: true });
  return { nodeRef, options: opts.result?.value ?? [] };
}

export async function chooseOption(session: CdpSession, nodeRef: string, value: string): Promise<void> {
  await session.send('Runtime.callFunctionOn', { objectId: nodeRef, functionDeclaration: SET_VALUE, arguments: [{ value }] });
}

export async function answerDialog(session: CdpSession, accept: boolean, text?: string): Promise<void> {
  await session.send('Page.handleJavaScriptDialog', { accept, ...(text === undefined ? {} : { promptText: text }) });
}

export async function setFiles(session: CdpSession, backendNodeId: number, paths: string[]): Promise<void> {
  await session.send('DOM.setFileInputFiles', { files: paths, backendNodeId });
}

export interface DialogInfo {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  url: string;
  defaultPrompt?: string;
}

export interface FileChooserInfo {
  backendNodeId: number;
  multiple: boolean;
}

export interface PageHooks {
  onDialog?: (d: DialogInfo) => void;
  onFileChooser?: (f: FileChooserInfo) => void;
}

/** Wires dialog and file chooser events of one tab; returns the unsubscribe. */
export function watchPage(session: CdpSession, hooks: PageHooks): () => void {
  void session.send('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => undefined);
  const offs = [
    session.on('Page.javascriptDialogOpening', (p) =>
      hooks.onDialog?.({ type: p.type, message: p.message, url: p.url, ...(p.defaultPrompt ? { defaultPrompt: p.defaultPrompt } : {}) }),
    ),
    session.on('Page.fileChooserOpened', (p) => hooks.onFileChooser?.({ backendNodeId: p.backendNodeId, multiple: p.mode === 'selectMultiple' })),
  ];
  return () => {
    for (const off of offs) off();
    void session.send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined);
  };
}

export interface DownloadEvent {
  state: 'started' | 'progress' | 'completed' | 'canceled';
  guid: string;
  url?: string;
  suggestedFilename?: string;
  /** Saved file path (named by guid with allowAndName); rename to suggestedFilename when completed. */
  path: string;
  receivedBytes?: number;
  totalBytes?: number;
}

/** Browser-level downloads into `downloadPath`; returns the unsubscribe. */
export async function watchDownloads(client: CdpClient, opts: { downloadPath: string }, onDownload: (e: DownloadEvent) => void): Promise<() => void> {
  const names = new Map<string, { url?: string; suggestedFilename?: string }>();
  const offs = [
    client.on('Browser.downloadWillBegin', (p) => {
      names.set(p.guid, { url: p.url, suggestedFilename: p.suggestedFilename });
      onDownload({ state: 'started', guid: p.guid, url: p.url, suggestedFilename: p.suggestedFilename, path: join(opts.downloadPath, p.guid) });
    }),
    client.on('Browser.downloadProgress', (p) => {
      const meta = names.get(p.guid) ?? {};
      const state = p.state === 'completed' ? 'completed' : p.state === 'canceled' ? 'canceled' : 'progress';
      if (state !== 'progress') names.delete(p.guid);
      onDownload({ state, guid: p.guid, ...meta, path: join(opts.downloadPath, p.guid), receivedBytes: p.receivedBytes, totalBytes: p.totalBytes });
    }),
  ];
  await client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: opts.downloadPath, eventsEnabled: true });
  return () => {
    for (const off of offs) off();
  };
}

export function isLocalHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

/** Certificate errors are ignored only for localhost / 127.0.0.1 pages and only when the setting is on. */
export async function applyCertPolicy(client: CdpClient, url: string, ignoreLocalCertErrors: boolean): Promise<boolean> {
  const ignore = ignoreLocalCertErrors && isLocalHost(url);
  await client.send('Security.setIgnoreCertificateErrors', { ignore });
  return ignore;
}
