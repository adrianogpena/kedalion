import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEol, parseXmlQueries, applyCombinedXml, combineXmlStatements, mergeXmlStatements, CodeEditor, detectEol, type Eol, FilePreview, HEX_LIMIT, type ImageInfo, langLabel, langOfFile, MarkdownEditor,
  type MarkdownEditorHandle, type MarkdownMode, normalizeEol, prepareForSave, previewKind, type PreviewContent, RICH_COMMAND_IDS, type RichCommandId, type RichHost, type SelectionInfo,
  exportHtml,
  SqlSteps, type SqlStepsTab, useEditorOptions,
} from '@kedalion/editor';
import {
  type ApiError, type BreadcrumbEntry, Breadcrumbs, Button, dialogs, errorOf, ErrorBanner, FILE_DEFAULTS, type FileSettings, formatBytes, Icon, PanelBanner, PanelLoading,
  relPath, requestBlob, StatusBar, type StatusItem, type TabAction, useCommand, useDialogs, useViewLink,
} from '@kedalion/ui';
import { explorerApi as api, type LogSettings, type TextEncoding } from '../client';
import { explorerCommandById as commandById } from '../commands';
import { fullPath } from '../explorer-paths';
import { inspectMarkdownConfig, useMarkdownSettings } from '../markdown-settings';
import { t } from '../i18n';
import { LogTab } from './LogTab';
import { useExplorerCurl } from './CurlPanel';
import { type ExplorerSqlProps, useExplorerSql } from './SqlPanel';
import { useChordOf, useTabActions } from './tab-actions';
import { relativeInside } from './untitled';
import { useLocalImages } from './useLocalImages';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; content: PreviewContent; mtime: number };

export interface FileTabProps {
  project: string;
  projectName: string;
  /** Absolute folder of the project: where the markdown file dialogs start and what picked paths are relative to. */
  projectPath?: string;
  path: string;
  /** The tab is selected and its pane has the focus. */
  focused: boolean;
  /** A preview tab keeps the focus where it was (the tree), so Delete, F2 and arrows still act on the tree. */
  preview?: boolean;
  /** Log viewer state (highlights, bookmarks) and its change handler; only log files use them. */
  logs?: LogSettings;
  onLogsChange?: (logs: LogSettings) => void;
  /** Wrap long lines in the editors (default on) and its change handler. */
  wrapLines?: boolean;
  onWrapLinesChange?: (wrap: boolean) => void;
  /** Save behaviour (auto-save, trim, final newline). */
  files?: Required<FileSettings>;
  /** Reports unsaved changes to the tab bar, and registers what saves the tab (see `TabContext`). */
  onDirty?: (dirty: boolean) => void;
  onSaver?: (save: (() => Promise<boolean>) | undefined) => void;
  /** Opens another file of the project (picked in the breadcrumbs). */
  onOpenPath?: (path: string) => void;
  /** Puts the tab's actions in the tab bar (see `TabContext.setActions`). */
  onActions?: (actions: TabAction[]) => void;
  /** Running SQL from `.sql` files of allowed projects (see `useExplorerSql`). */
  sql?: ExplorerSqlProps;
}

/** Line breaks of new files and of files without any: the OS's, like VS Code's `files.eol: auto`. */
export const OS_EOL: Eol = typeof navigator !== 'undefined' && /^Win/.test(navigator.platform) ? '\r\n' : '\n';
const AUTO_SAVE_DELAY = 1000;

/** Text kinds whose tab opens in the preview (the toggle switches to the editor). */
const PREVIEW_FIRST = new Set(['table', 'notebook', 'har']);
/** Text kinds with a preview the toggle can switch to. */
const TOGGLES = new Set(['json', 'html', 'env', 'table', 'notebook', 'har']);
const BLOB_KINDS = new Set(['image', 'svg', 'audio', 'video']);
const ENCODING_LABELS: Record<TextEncoding, string> = {
  utf8: 'UTF-8', utf8bom: 'UTF-8 with BOM', utf16le: 'UTF-16 LE', utf16be: 'UTF-16 BE', windows1252: 'Windows 1252',
};
const eolLabel = (eol: Eol) => (eol === '\n' ? 'LF' : 'CRLF');

/** VS Code's selection item: `Ln 12, Col 4 (3 selected)`, or the count of several selections. */
export function positionText(s: SelectionInfo): string {
  if (s.selections > 1) {
    return s.selected
      ? t('explorer.status.selectionsChars', { count: s.selections, chars: s.selected })
      : t('explorer.status.selections', { count: s.selections });
  }
  const at = t('explorer.status.position', { line: s.line, col: s.col });
  return s.selected ? `${at} ${t('explorer.status.selected', { count: s.selected })}` : at;
}

/** Markdown mode and Source cursor per file; the Explorer unmounts when the view changes, so tabs restore from here. */
const mdViewState = new Map<string, { mode: MarkdownMode; pos?: number; rich?: { pos: number; scroll: number } }>();

/** One open file: log files get the log viewer, the rest `TextFileTab`. */
export function FileTab(props: FileTabProps) {
  return previewKind(relPath.basename(props.path)) === 'log' ? <LogTab {...props} /> : <TextFileTab {...props} />;
}

/** A preview by extension, and for text files an editor with Save (Ctrl+S). */
function TextFileTab({ project, projectName, projectPath, path, focused, preview, wrapLines: wrapLinesProp, onWrapLinesChange, files = FILE_DEFAULTS, onDirty, onSaver, onOpenPath, onActions, sql }: FileTabProps) {
  const wrapLines = wrapLinesProp ?? useEditorOptions()?.wordWrap ?? true;
  const name = relPath.basename(path);
  const markdown = previewKind(name) === 'markdown';
  const resolveImage = useLocalImages(project, path);
  const viewHtml = useCallback(async () => (await api.fsViewTicket(project, path)).url, [project, path]);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [previewing, setPreviewing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError>();
  /** How the file is stored on disk; the editor always holds `\n` breaks. */
  const format = useRef<{ encoding: TextEncoding; eol: Eol }>({ encoding: 'utf8', eol: OS_EOL });
  /** The line breaks the next save writes; differing from the file's makes the tab dirty. */
  const [eol, setEol] = useState<Eol>(OS_EOL);
  const [disk, setDisk] = useState<{ size?: number; readOnly?: boolean }>({});
  const [selection, setSelection] = useState<SelectionInfo>();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [stepsTab, setStepsTab] = useState<SqlStepsTab>('steps');
  const [image, setImage] = useState<ImageInfo>();
  const generation = useRef(0);
  const dirtyRef = useRef(false);
  const blobUrl = useRef<string>();
  const { confirm, element } = useDialogs();

  const revoke = () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = undefined;
  };

  const load = useCallback(async (silent = false) => {
    const gen = ++generation.current;
    if (!silent) {
      setState({ status: 'loading' });
      setPreviewing(PREVIEW_FIRST.has(previewKind(name)));
      setSaveError(undefined);
    }
    try {
      const kind = previewKind(name);
      if (BLOB_KINDS.has(kind)) {
        const blob = await requestBlob('/api/fs/raw', { root: project, path });
        const source = kind === 'svg' ? await blob.text() : undefined;
        const url = URL.createObjectURL(blob);
        if (gen !== generation.current) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke();
        blobUrl.current = url;
        setDisk({ size: blob.size });
        setState({ status: 'ready', content: { url, source }, mtime: 0 });
      } else if (kind === 'archive') {
        const archive = await api.fsArchive(project, path);
        if (gen === generation.current) setState({ status: 'ready', content: { archive }, mtime: 0 });
      } else if (kind === 'pdf') {
        const pdf = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path })).arrayBuffer());
        if (gen === generation.current) setState({ status: 'ready', content: { pdf }, mtime: 0 });
      } else if (kind === 'font' || kind === 'hex') {
        const limit = kind === 'hex' ? HEX_LIMIT : undefined;
        const bytes = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path, limit })).arrayBuffer());
        if (gen === generation.current) setState({ status: 'ready', content: { bytes }, mtime: 0 });
      } else if (kind === 'sqlite') {
        const sqlite = await api.fsSqlite(project, path);
        const load = (table: string, offset: number) => api.fsSqlite(project, path, table, offset);
        if (gen === generation.current) setState({ status: 'ready', content: { sqlite, load }, mtime: 0 });
      } else {
        const read = await api.fsRead(project, path);
        let content: PreviewContent = read;
        if ('text' in read) {
          format.current = { encoding: read.encoding, eol: detectEol(read.text, OS_EOL) };
          content = { ...read, text: normalizeEol(read.text) };
        }
        const readOnly = 'text' in read && read.readOnly === true;
        if ('binary' in read) {
          try {
            const bytes = new Uint8Array(await (await requestBlob('/api/fs/raw', { root: project, path, limit: HEX_LIMIT })).arrayBuffer());
            content = { bytes };
          } catch {
            content = read;
          }
        }
        // A disk reload that resolves after the user started typing keeps their draft.
        if (gen === generation.current && !(silent && dirtyRef.current)) {
          if ('text' in content) setDraft(content.text);
          setEol(format.current.eol);
          setDisk({ size: read.size, readOnly });
          setState({ status: 'ready', content, mtime: read.mtime });
        }
      }
    } catch (err) {
      if (gen === generation.current) setState({ status: 'error', error: errorOf(err) });
    }
  }, [project, path, name]);

  useEffect(() => {
    if (!dirtyRef.current) void load();
  }, [load]);
  const known = useRef<string>();
  useEffect(() => {
    known.current = undefined;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const st = await api.fsStat(project, path);
        const stamp = `${st.mtime}:${st.size}`;
        const prev = known.current;
        if (prev === stamp) return;
        if (prev !== undefined && dirtyRef.current) return;
        known.current = stamp;
        if (prev !== undefined) void load(true);
      } catch {
        // the file may be mid-write or gone; the next tick retries
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [project, path, load]);
  useEffect(() => () => {
    generation.current++;
    revoke();
  }, []);

  const content = state.status === 'ready' ? state.content : undefined;
  const text = content && 'text' in content ? content.text : undefined;
  const editable = text !== undefined && !(content && 'truncated' in content && content.truncated);
  // Editable files open straight in the editor; only JSON can switch to its tree preview.
  const active = editable && !previewing;
  const mdEditor = markdown && active;
  const dirty = active && text !== undefined && (draft !== text || eol !== format.current.eol);
  dirtyRef.current = dirty;

  const confirmDiscard = async () =>
    !dirty || confirm({ title: t('explorer.discardTitle'), body: t('explorer.discardBody', { name }), okLabel: t('explorer.discard'), danger: true });

  const toggleEdit = async () => {
    if (previewing) {
      setDraft(text ?? '');
      setSaveError(undefined);
      setPreviewing(false);
      return;
    }
    if (!(await confirmDiscard())) return;
    setSaveError(undefined);
    setPreviewing(true);
  };

  const reload = async () => {
    if (await confirmDiscard()) void load();
  };

  /** `overwrite` skips the changed-on-disk check; `unlock` clears the file's read-only flag first. Resolves true when the file is saved or had nothing to save. */
  const save = async (opts: { overwrite?: boolean; unlock?: boolean } = {}): Promise<boolean> => {
    if (!dirty) return true;
    if (saving || state.status !== 'ready') return false;
    setSaving(true);
    setSaveError(undefined);
    const typed = draft;
    const text = prepareForSave(typed, { trim: files.trimTrailingWhitespace, finalNewline: files.insertFinalNewline, markdown });
    const breaks = eol;
    try {
      const saved = await api.fsWrite(project, path, applyEol(text, breaks), opts.overwrite ? undefined : state.mtime, format.current.encoding, opts.unlock);
      // Our own write is no change on disk for the poll below.
      known.current = `${saved.mtime}:${saved.size}`;
      format.current = { ...format.current, eol: breaks };
      setDisk((d) => ({ size: saved.size, readOnly: opts.unlock ? false : d.readOnly }));
      setDraft((d) => (d === typed ? text : d));
      setState({ status: 'ready', content: { text }, mtime: saved.mtime });
      return true;
    } catch (err) {
      setSaveError(errorOf(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  useCommand(commandById('explorer.file.save'), () => void save(), { enabled: focused && active });
  const toggleWrap = () => onWrapLinesChange?.(!wrapLines);
  useCommand(commandById('explorer.file.wrap'), toggleWrap, { enabled: focused && active && Boolean(onWrapLinesChange) });
  const mdSettings = useMarkdownSettings(files.markdownToc);
  /** Rich or Source, per tab; a new tab starts in the default mode. */
  const mdKey = `${project}\0${path}`;
  const [mdMode, setMdModeState] = useState<MarkdownMode>(() => mdViewState.get(mdKey)?.mode ?? mdSettings.defaultMode);
  const setMdMode = (update: (m: MarkdownMode) => MarkdownMode) => setMdModeState((m) => {
    const next = update(m);
    mdViewState.set(mdKey, { mode: next });
    return next;
  });
  const onMdSelection = (info: SelectionInfo) => {
    setSelection(info);
    mdViewState.set(mdKey, { mode: 'source', pos: info.pos });
  };
  const onRichView = (rich: { pos: number; scroll: number }) => mdViewState.set(mdKey, { mode: 'rich', rich });
  const mdEditorRef = useRef<MarkdownEditorHandle>(null);
  const onOpenPathRef = useRef(onOpenPath);
  onOpenPathRef.current = onOpenPath;
  const mdHost = useMemo<RichHost>(() => ({
    filePath: path,
    onOpenPath: (p) => onOpenPathRef.current?.(p),
    pickFile: async () => {
      const abs = await dialogs.pickFile({ title: t('explorer.md.pickFileTitle'), purpose: 'markdown-link' });
      return abs && projectPath ? (relativeInside(projectPath, abs) ?? null) : null;
    },
    saveAs: async (defaultName, content) => {
      const start = projectPath ? fullPath(projectPath, relPath.dirname(path)) : undefined;
      const ext = /\.([^./]+)$/.exec(defaultName)?.[1] ?? '';
      const target = await dialogs.saveAs({
        purpose: 'file-export',
        suggestedName: defaultName,
        ...(start && { start }),
        filters: [...(ext ? [{ name: ext.toUpperCase(), patterns: [`*.${ext}`] }] : []), { name: 'All files', patterns: ['*.*'] }],
      });
      if (target === null) return false;
      await api.fsSaveNew({ text: content, target });
      return true;
    },
    resolveImage,
    settings: mdSettings,
  }), [path, projectPath, resolveImage, mdSettings]);
  const toggleSource = () => {
    setSelection(undefined);
    setMdMode((m) => (m === 'rich' ? 'source' : 'rich'));
  };
  const exportMarkdown = async () => {
    try {
      const html = await exportHtml(draft, { title: name, resolveImage });
      await mdHost.saveAs(name.replace(/\.[^./]*$/, '') + '.html', html);
    } catch (err) {
      setSaveError(errorOf(err));
    }
  };
  const runMarkdown = (id: RichCommandId) => {
    if (id === 'toggleSource') toggleSource();
    else if (id === 'exportHtml') void exportMarkdown();
    else if (id === 'inspectConfig') inspectMarkdownConfig();
    else mdEditorRef.current?.run(id);
  };
  // Fixed order, so the hooks run the same way every render.
  for (const id of RICH_COMMAND_IDS) useCommand(commandById(`explorer.markdown.${id}`), () => runMarkdown(id), { enabled: focused && mdEditor });
  const [crumbSignal, setCrumbSignal] = useState(0);
  useCommand(commandById('explorer.breadcrumbs'), () => setCrumbSignal((n) => n + 1), { enabled: focused && files.breadcrumbs });
  const listDir = useCallback(
    async (dir: string): Promise<BreadcrumbEntry[]> =>
      (await api.fsList(project, dir)).map((e) => ({
        name: e.name,
        kind: e.kind === 'dir' || e.target === 'dir' ? 'dir' : 'file',
        path: relPath.join(dir, e.name),
      })),
    [project],
  );

  const saveRef = useRef(save);
  saveRef.current = save;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const onSaverRef = useRef(onSaver);
  onSaverRef.current = onSaver;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    onSaverRef.current?.(() => saveRef.current());
    return () => {
      onSaverRef.current?.(undefined);
      onDirtyRef.current?.(false);
    };
  }, []);
  const conflict = saveError?.code === 'fileChanged';
  const lockedFile = saveError?.code === 'fileReadOnly';
  // Both wait for the user's choice; auto-save would only repeat the error.
  const blocked = conflict || lockedFile;
  useEffect(() => {
    if (files.autoSave !== 'afterDelay' || !dirty || blocked) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTO_SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [draft, eol, dirty, blocked, files.autoSave]);
  useEffect(() => {
    if (files.autoSave !== 'onFocusChange') return;
    if (!focused) void saveRef.current();
    const onBlur = () => void saveRef.current();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [focused, files.autoSave]);

  const overwrite = async () => {
    const ok = await confirm({ title: t('explorer.overwriteTitle'), body: t('explorer.overwriteBody', { name }), okLabel: t('explorer.overwrite'), danger: true });
    if (ok) void save({ overwrite: true });
  };

  const xml = useMemo(() => (/\.xml$/i.test(name) ? parseXmlQueries(draft) : null), [name, draft]);
  const [xmlRaw, setXmlRaw] = useState(false);
  const xmlStmts = xml && !xmlRaw ? xml.statements : undefined;
  const [merged, setMerged] = useState(false);
  const mergeOn = merged && !!xmlStmts && xmlStmts.length > 1;
  const editorValue = useMemo(() => (xmlStmts ? (mergeOn ? mergeXmlStatements(xmlStmts) : combineXmlStatements(xmlStmts)) : draft), [xmlStmts, draft, mergeOn]);
  const onEditorChange = (v: string) => {
    if (mergeOn) return;
    setDraft(xmlStmts ? applyCombinedXml(draft, xmlStmts, v) : v);
  };
  const sqlUi = useExplorerSql({ project, name, path, asSql: !!xmlStmts, active, focused, draft: editorValue, sql, confirm, onRunStart: () => setStepsOpen(false) });
  const curlUi = useExplorerCurl({ name, active, draft, cursor: selection?.pos, sql });
  const chordOf = useChordOf();
  const stepsPanel = (): ReactNode => isSql && stepsOpen ? (
    <SqlSteps
      bottom
      text={editorValue}
      cursor={selection?.pos}
      onJump={(from, to) => sqlUi.editor.current?.reveal(from, to)}
      onClose={() => setStepsOpen(false)}
      tab={stepsTab}
      onTab={setStepsTab}
      paramValues={sqlUi.paramValues}
      onParamValue={sqlUi.setParamValue}
    />
  ) : undefined;
  const openSteps = () => {
    sqlUi.closeResults();
    setStepsOpen(true);
  };
  const toWorkbench = useViewLink('workbench');
  const openInWorkbench = async () => {
    if (!sql || !toWorkbench) return;
    if (dirty && !(await save())) return;
    sql.onWorkbenchChange({ ...sql.workbench, doc: { kind: 'file', project, path } });
    toWorkbench();
  };
  const actions: TabAction[] = [...sqlUi.actions, ...curlUi.actions];
  const isSql = langOfFile(name) === 'sql' || !!xmlStmts;
  if (xml && active) {
    actions.push({ id: 'xml.sql', group: 'primary', icon: 'database', label: t('explorer.sql.xmlView'), checked: !xmlRaw, run: () => setXmlRaw(!xmlRaw) });
  }
  if (active && xmlStmts && xmlStmts.length > 1) {
    actions.push({ id: 'sql.merge', group: 'primary', icon: 'copy', label: t('explorer.sql.merge'), checked: mergeOn, run: () => setMerged(!mergeOn) });
  }
  if (isSql && editable) {
    actions.push({ id: 'sql.steps', group: 'primary', icon: 'list-flat', label: t('explorer.sql.steps'), checked: stepsOpen, run: () => (stepsOpen ? setStepsOpen(false) : openSteps()) });
  }
  const showProblems = () => {
    setStepsTab('problems');
    openSteps();
  };
  useCommand(commandById('explorer.sql.problems'), showProblems, { enabled: focused && active && isSql && editable });
  if (editable && TOGGLES.has(previewKind(name))) {
    actions.push({ id: 'preview', group: 'primary', icon: 'preview', label: t('explorer.preview'), checked: previewing, run: () => void toggleEdit() });
  }
  if (mdEditor) {
    actions.push({ id: 'md.source', group: 'primary', icon: 'code', label: t('explorer.md.useSource'), hint: chordOf('explorer.markdown.toggleSource'), checked: mdMode === 'source', run: toggleSource });
  }
  if (active && onWrapLinesChange) {
    actions.push({ id: 'wrap', group: 'menu', section: 'view', label: t('explorer.wrap'), hint: chordOf('explorer.file.wrap'), checked: wrapLines, run: toggleWrap });
  }
  if (active) {
    actions.push({ id: 'save', group: 'menu', section: 'file', label: t('explorer.save'), hint: chordOf('explorer.file.save'), disabled: !dirty || saving, run: () => void save() });
  }
  actions.push({ id: 'reload', group: 'menu', section: 'file', icon: 'refresh', label: t('explorer.reload'), run: () => void reload() });
  if (sql && sqlUi.enabled && toWorkbench) {
    actions.push({ id: 'sql.openWorkbench', group: 'menu', section: 'file', label: t('explorer.sql.openWorkbench'), run: () => void openInWorkbench() });
  }
  useTabActions(actions, onActions);

  const status: StatusItem[] = [];
  if (content) {
    if (active && selection) status.push({ id: 'position', text: positionText(selection) });
    if (image && image.width > 0) {
      status.push({ id: 'image', text: `${image.width} × ${image.height}`, title: t('explorer.status.imageSize') });
      status.push({ id: 'zoom', text: `${Math.round(image.zoom * 100)}%`, title: t('explorer.status.zoom') });
    }
    if (text !== undefined) {
      status.push({ id: 'encoding', text: ENCODING_LABELS[format.current.encoding], title: t('explorer.status.encoding') });
      const other: Eol = eol === '\n' ? '\r\n' : '\n';
      status.push(active
        ? { id: 'eol', text: eolLabel(eol), title: t('explorer.status.eol', { eol: eolLabel(other) }), onClick: () => setEol(other) }
        : { id: 'eol', text: eolLabel(eol) });
      status.push({ id: 'language', text: langLabel(langOfFile(name)), title: t('explorer.status.language') });
    }
    if (disk.size !== undefined) status.push({ id: 'size', text: formatBytes(disk.size), title: t('explorer.status.size') });
    if (disk.readOnly) status.push({ id: 'readOnly', text: <><Icon name="lock" size={12} /> {t('explorer.status.readOnly')}</> });
    if (text !== undefined && !editable) status.push({ id: 'truncated', text: t('explorer.status.truncated') });
  }

  return (
    <div className="xp-file">
      {element}
      {files.breadcrumbs && (
        <div className="xp-bar">
          <Breadcrumbs root={projectName} path={path} list={listDir} onPick={(e) => onOpenPath?.(e.path)} focusSignal={crumbSignal} title={`${projectName}/${path}`} />
        </div>
      )}
      {conflict ? (
        <PanelBanner tone="err" icon="alert" action={
          <>
            <Button size="sm" icon="refresh" onClick={reload} title={t('explorer.reload')}>{t('explorer.reload')}</Button>
            <Button size="sm" variant="danger" onClick={overwrite} title={t('explorer.overwrite')}>{t('explorer.overwrite')}</Button>
          </>
        }>
          {t('explorer.staleSave', { name })}
        </PanelBanner>
      ) : lockedFile ? (
        <PanelBanner tone="err" icon="lock" action={<Button size="sm"onClick={() => void save({ unlock: true })} title={t('explorer.makeWritable')}>{t('explorer.makeWritable')}</Button>}>
          {t('explorer.readOnlySave', { name })}
        </PanelBanner>
      ) : saveError && <ErrorBanner error={saveError} compact />}
      <div className="xp-body">
        {state.status === 'loading' && <PanelLoading />}
        {state.status === 'error' && <ErrorBanner error={state.error} onRetry={() => void load()} />}
        {content && (mdEditor
          ? <MarkdownEditor ref={mdEditorRef} value={draft} onChange={setDraft} mode={mdMode} host={mdHost} wrap={wrapLines} autoFocus={!preview} onSelection={onMdSelection} initialPos={mdMode === 'source' ? mdViewState.get(mdKey)?.pos : undefined} initialRich={mdMode === 'rich' ? mdViewState.get(mdKey)?.rich : undefined} onRichView={onRichView} />
          :active
          ? curlUi.enabled
            ? curlUi.layout(<CodeEditor ref={curlUi.editor} value={draft} lang={langOfFile(name)} onChange={setDraft} height="100%" wrap={wrapLines} autoFocus={!preview} onSelection={setSelection} {...curlUi.editorProps} />)
            : sqlUi.layout(<CodeEditor ref={sqlUi.editor} value={editorValue} lang={xmlStmts ? 'sql' : langOfFile(name)} onChange={onEditorChange} readOnly={mergeOn} height="100%" wrap={wrapLines} autoFocus={!preview} onSelection={setSelection} sqlLint={isSql} {...sqlUi.editorProps} />, stepsPanel())
          : <FilePreview name={name} content={content} onImageInfo={setImage} toc={files.markdownToc} resolveImage={resolveImage} viewHtml={viewHtml} />)}
      </div>
      {status.length > 0 && <StatusBar items={status} />}
    </div>
  );
}
