import { Button, ContextMenu, copyNotify, IconButton, effectiveKeys, errorMessage, errorOf, paletteCommand, request, t, useDialogs, useKeybindings, useToast, type CommandDef } from '@kedalion/ui';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { attachSession, closeSession, isSessionGone, openSession, socketUrl, type TerminalCwd, type TerminalLaunch } from './client.ts';
import { withAppearance, type ProfileAppearance } from './appearance.ts';
import { PANE_COMMANDS, terminalKeyAction, type PaneCommand } from './keys.ts';
import { pasteNeedsWarning, pasteSummary, sanitizePaste } from './paste.ts';
import { compileTriggers, type TerminalTrigger } from './output-scan.ts';
import { decodeServerMessage, encodeControl, type CaptureRecord, type CommandRecord, type EarlierHit, type ResultRecord, type TerminalAlerts } from './protocol.ts';
import { useTerminalOptions } from './terminalOptions.ts';
import { createXtermView, type CommandMark, type HintTarget, type TerminalLinks, type TerminalOptions, type XtermView } from './xterm-view.ts';
import './terminal.css';

/** Server close codes (see `terminalRoutes`). */
const BACKPRESSURE_CLOSE = 4001;
const NO_SESSION_CLOSE = 1008;
const NORMAL_CLOSE = 1000;
const MAX_BACKOFF = 30_000;
/** The command that opens the find bar (registered by the app); the key is the fallback without a keymap. */
const FIND_COMMAND = 'terminal.find';
const DEFAULT_FIND_KEY = 'Ctrl+Shift+F';
/** Scroll to the previous / next prompt (shell integration); same fallback rule as find. */
const PREV_COMMAND = 'terminal.prevCommand';
const NEXT_COMMAND = 'terminal.nextCommand';
const DEFAULT_PREV_KEY = 'Ctrl+ArrowUp';
const DEFAULT_NEXT_KEY = 'Ctrl+ArrowDown';
const MIN_FONT = 6;
const HINT_LETTERS = 'asdfghjklqwertyuiopzxcvbnm';
const EARLIER_DELAY = 300;
const MAX_FONT = 72;
const DEFAULT_FONT = 13;

/** What the app can make a pane do (tab menus): the pane commands. */
export interface TerminalPaneHandle {
  run(command: PaneCommand): void;
  /** Pastes text into the program as typed input, without a trailing Enter. */
  insert(text: string): void;
  /** Types text and presses Enter. */
  submit(text: string): void;
  /** Scrolls to the newest command with this line still in the buffer; false when none. */
  scrollToCommand(command: string): boolean;
}

/** Where a pane opens what its links point at; paths arrive absolute and existing. */
export type PaneLinks = Omit<TerminalLinks, 'resolve'>;

/** Labels for `n` hints: single letters while they last, else two. */
function hintLabels(n: number): string[] {
  const L = HINT_LETTERS;
  if (n <= L.length) return [...L.slice(0, n)];
  const out: string[] = [];
  for (const a of L) for (const b of L) if (out.length < n) out.push(a + b);
  return out;
}

let audio: AudioContext | null = null;
let lastBeep = 0;
/** A short beep, at most one per 200 ms. */
function beep() {
  const now = Date.now();
  if (now - lastBeep < 200) return;
  lastBeep = now;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.12);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch {
    // no audio here
  }
}

export interface TerminalPaneProps {
  /** The session to attach to; none opens a new one and reports it through `onSession`. */
  session?: string;
  /** Where a new session starts; the user's home when absent. */
  cwd?: TerminalCwd;
  /** A launcher the app registered on the server, instead of the configured shell. */
  launch?: TerminalLaunch;
  /** Profile id for a new session; none: the default one. */
  profile?: string;
  /** Absolute folder a new session starts in (wins over `cwd`); the server falls back when it is gone. */
  dir?: string;
  /** Opens a new shell when the session exits, instead of the exit overlay. */
  restartOnExit?: boolean;
  /** Read-only, at the session's own size, scaled to the box. */
  preview?: boolean;
  /** App commands whose keys still work while the terminal has focus; default: the command palette. */
  appKeys?: CommandDef[];
  fontSize?: number;
  /** Look and behavior preferences; without it the app-wide ones (TerminalOptionsContext), else the built-in defaults. */
  options?: TerminalOptions;
  onSession?: (id: string) => void;
  onExit?: (code: number | null) => void;
  onTitle?: (title: string) => void;
  /** The shell's folder changed (OSC 7). */
  onCwd?: (cwd: string) => void;
  onBell?: () => void;
  /** Shell integration: a command started (true) or finished (false). */
  onRunning?: (running: boolean) => void;
  /** The profile's look, over `options`. */
  appearance?: ProfileAppearance;
  /** Shell id of the session (`SessionInfo.shell`): how a sanitized paste continues lines. */
  shell?: string;
  /** False dims the pane by `options.dimUnfocused` (a split pane without the focus); true focuses it. */
  focused?: boolean;
  /** Gets the pane's handle once mounted, null when it goes. */
  handle?: (h: TerminalPaneHandle | null) => void;
  /** Triggers; the pane colors the lines of the `highlight` ones. */
  triggers?: TerminalTrigger[];
  /** Opens file paths and commit hashes found on screen; none leaves them plain text. */
  links?: PaneLinks;
  /** False while the tab is hidden; with the window's focus it tells the server whether a long command needs a notification. */
  visible?: boolean;
  /** A command started or ended (shell integration). */
  onCommandRecord?: (record: CommandRecord) => void;
  onResult?: (record: ResultRecord) => void;
  onCapture?: (record: CaptureRecord) => void;
  onAlerts?: (alerts: TerminalAlerts) => void;
}

type Status =
  | { kind: 'connecting' }
  | { kind: 'live' }
  | { kind: 'reconnecting' }
  | { kind: 'exited'; code: number | null }
  | { kind: 'ended' }
  | { kind: 'detached' }
  | { kind: 'error'; message: string };

interface Controller {
  /** The session the pane is connected (or connecting) to. */
  session(): string | undefined;
  attach(id: string): void;
  restart(): void;
  reattach(): void;
}

/**
 * A terminal session in a box. Unmounting only closes the socket: the shell keeps running until
 * `closeSession`, its own exit, or app quit. While focus is inside, keys go to the program except
 * the `appKeys` commands (the container is `data-keys="own"`).
 */
export function TerminalPane(props: TerminalPaneProps) {
  const { preview = false } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const controller = useRef<Controller | null>(null);
  const viewRef = useRef<XtermView | null>(null);
  const contextOptions = useTerminalOptions();
  const baseOptions = withAppearance(props.options ?? contextOptions, props.appearance);
  const baseKey = baseOptions === undefined ? undefined : JSON.stringify(baseOptions);
  const [zoom, setZoom] = useState(0);
  const options = useMemo((): TerminalOptions | undefined => {
    if (!zoom) return baseOptions;
    const size = (baseOptions?.fontSize ?? props.fontSize ?? DEFAULT_FONT) + zoom;
    return { ...baseOptions, fontSize: Math.max(MIN_FONT, Math.min(MAX_FONT, size)) };
  }, [baseKey, zoom, props.fontSize]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [finding, setFinding] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [found, setFound] = useState({ index: -1, count: 0 });
  const findInput = useRef<HTMLInputElement>(null);
  const [earlier, setEarlier] = useState<{ count: number; hits: EarlierHit[] } | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [markMenu, setMarkMenu] = useState<{ mark: CommandMark; at: { x: number; y: number } } | null>(null);
  const [hints, setHints] = useState<Array<HintTarget & { label: string }> | null>(null);
  const [typed, setTyped] = useState('');
  const hintsRef = useRef<{ list: Array<HintTarget & { label: string }>; typed: string } | null>(null);
  hintsRef.current = hints ? { list: hints, typed } : null;
  const sessionRef = useRef<string | undefined>(undefined);
  const sendRef = useRef<(data: string | Uint8Array) => void>(() => {});

  const kb = useKeybindings();
  const appKeys = useMemo(() => props.appKeys ?? [paletteCommand()], [props.appKeys]);
  const appChords = useRef(new Set<string>());
  appChords.current = useMemo(() => {
    const keys = kb ? effectiveKeys(kb.defs, kb.keymap) : new Map<string, string[]>();
    return new Set(appKeys.flatMap((d) => keys.get(d.id) ?? d.keys).map((c) => c.split(' ')[0]));
  }, [kb, appKeys]);

  const findChords = useRef(new Set<string>());
  findChords.current = useMemo(() => {
    const keys = kb ? effectiveKeys(kb.defs, kb.keymap).get(FIND_COMMAND) : undefined;
    return new Set((keys ?? [DEFAULT_FIND_KEY]).map((c) => c.split(' ')[0]));
  }, [kb]);

  const paneChords = useRef(new Map<string, PaneCommand>());
  paneChords.current = useMemo(() => {
    const keys = kb ? effectiveKeys(kb.defs, kb.keymap) : undefined;
    const out = new Map<string, PaneCommand>();
    for (const [id, fallback] of Object.entries(PANE_COMMANDS) as [PaneCommand, readonly string[]][]) {
      for (const c of keys?.get(id) ?? fallback) out.set(c.split(' ')[0], id);
    }
    return out;
  }, [kb]);

  const dialogs = useDialogs();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const dialogsRef = useRef(dialogs);
  dialogsRef.current = dialogs;

  const navChords = useRef({ prev: new Set<string>(), next: new Set<string>() });
  navChords.current = useMemo(() => {
    const keys = kb ? effectiveKeys(kb.defs, kb.keymap) : undefined;
    const set = (id: string, fallback: string) => new Set((keys?.get(id) ?? [fallback]).map((c) => c.split(' ')[0]));
    return { prev: set(PREV_COMMAND, DEFAULT_PREV_KEY), next: set(NEXT_COMMAND, DEFAULT_NEXT_KEY) };
  }, [kb]);

  useEffect(() => {
    const host = hostRef.current!;
    let disposed = false;
    let ws: WebSocket | null = null;
    let sessionId = latest.current.session;
    let decoder = new TextDecoder();
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;
    let sessionChecked = false;
    const encoder = new TextEncoder();

    const view: XtermView = createXtermView(host, {
      readOnly: preview,
      fontSize: latest.current.fontSize,
      options: optionsRef.current,
      onCwd: (cwd) => latest.current.onCwd?.(cwd),
      onBell: () => {
        const style = optionsRef.current?.bellStyle ?? 'tab';
        if (style === 'sound' || style === 'both') beep();
        latest.current.onBell?.();
      },
      onCommand: (running) => latest.current.onRunning?.(running),
      onMarkClick: (mark, at) => setMarkMenu({ mark, at }),
      links: preview
        ? undefined
        : {
            resolve: (paths) => resolvePaths(paths),
            openPath: (path, line) => latest.current.links?.openPath(path, line),
            openCommit: (hash) => latest.current.links?.openCommit(hash),
          },
      onPaste: (text) => {
        const o = optionsRef.current;
        if (preview || !pasteNeedsWarning(text, o?.pasteWarning ?? 'multiLine', o?.pasteLargeSize ?? 5120)) return false;
        void askPaste(text);
        return true;
      },
      onKey: (e) => {
        if (preview || e.type !== 'keydown') return true;
        if (hintsRef.current) {
          e.preventDefault();
          hintKey(e);
          return false;
        }
        if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          // xterm sends a bare CR for Shift+Enter; ESC+CR is the newline sequence Claude Code reads.
          e.preventDefault();
          send(encoder.encode('\x1b\r'));
          return false;
        }
        const action = terminalKeyAction(e, view.hasSelection(), appChords.current, findChords.current, navChords.current, paneChords.current);
        if (action.startsWith('terminal.')) {
          e.preventDefault();
          runPane(action as PaneCommand);
          return false;
        }
        switch (action) {
          case 'prevCommand':
            e.preventDefault();
            view.scrollToPrompt(-1);
            return false;
          case 'nextCommand':
            e.preventDefault();
            view.scrollToPrompt(1);
            return false;
          case 'find':
            e.preventDefault();
            setFinding(true);
            requestAnimationFrame(() => findInput.current?.select());
            return false;
          case 'app':
          case 'paste': // the browser's paste event reaches xterm
            return false;
          case 'copy':
            e.preventDefault();
            void copyNotify(view.getSelection());
            return false;
          default:
            return true;
        }
      },
    });

    async function askPaste(text: string) {
      const { lines, chars, preview: sample } = pasteSummary(text);
      const choice = await dialogsRef.current.choose({
        title: lines > 1 ? t('terminal.paste.title', { lines }) : t('terminal.paste.titleLarge', { chars }),
        body: (
          <>
            <p>{t('terminal.paste.body', { lines, chars })}</p>
            <pre className="terminal-paste-preview">{sample}</pre>
            <p className="muted">{t('terminal.paste.sanitizeHint')}</p>
          </>
        ),
        choices: [
          { id: 'sanitize', label: t('terminal.paste.sanitize') },
          { id: 'paste', label: t('terminal.paste.paste') },
        ],
      });
      if (disposed || !choice) return;
      view.paste(choice === 'paste' ? text : sanitizePaste(text, { bracketed: view.bracketedPaste(), shell: latest.current.shell }));
      view.focus();
    }

    async function resolvePaths(paths: string[]): Promise<Array<string | null>> {
      const session = sessionRef.current;
      if (!session || !latest.current.links) return paths.map(() => null);
      return request<Array<string | null>>('POST', '/api/terminal/resolve-paths', {}, { session, paths });
    }

    function showHints() {
      const found = view.hintTargets();
      if (!found.length) {
        toastRef.current({ message: t('terminal.hints.none') });
        return;
      }
      const labels = hintLabels(found.length);
      setTyped('');
      setHints(found.map((h, i) => ({ ...h, label: labels[i] })));
    }

    async function openHint(h: HintTarget, copy: boolean) {
      const links = latest.current.links;
      if (copy) return void copyNotify(h.text);
      if (h.kind === 'url') return void window.open(h.text, '_blank', 'noopener');
      if (h.kind === 'hash') return links ? links.openCommit(h.text) : void copyNotify(h.text);
      const [abs] = await resolvePaths([h.text]).catch(() => [null]);
      if (abs && links) links.openPath(abs, h.line);
      else void copyNotify(h.text);
    }

    function hintKey(e: KeyboardEvent) {
      const state = hintsRef.current;
      if (!state) return;
      const key = e.key.toLowerCase();
      if (e.key === 'Escape' || key.length !== 1 || !/[a-z]/.test(key)) {
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
        setHints(null);
        return;
      }
      const next = state.typed + key;
      const hit = state.list.find((h) => h.label === next);
      if (hit) {
        setHints(null);
        void openHint(hit, e.shiftKey);
        return;
      }
      if (state.list.some((h) => h.label.startsWith(next))) setTyped(next);
      else setHints(null);
    }

    function runPane(command: PaneCommand) {
      switch (command) {
        case 'terminal.hints':
          return showHints();
        case 'terminal.zoomIn':
          return setZoom((z) => z + 1);
        case 'terminal.zoomOut':
          return setZoom((z) => z - 1);
        case 'terminal.zoomReset':
          return setZoom(0);
        case 'terminal.clear':
          view.clear();
          return send(encodeControl({ type: 'clear' }));
        case 'terminal.scrollLineUp':
          return view.scroll('lineUp');
        case 'terminal.scrollLineDown':
          return view.scroll('lineDown');
        case 'terminal.scrollPageUp':
          return view.scroll('pageUp');
        case 'terminal.scrollPageDown':
          return view.scroll('pageDown');
        case 'terminal.scrollTop':
          return view.scroll('top');
        case 'terminal.scrollBottom':
          return view.scroll('bottom');
      }
    }
    viewRef.current = view;
    view.onFindResults((index, count) => setFound({ index, count }));
    const send = (data: string | Uint8Array) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    };
    sendRef.current = send;
    sessionRef.current = sessionId;
    view.onInput((data) => send(encoder.encode(data)));
    view.onBinary((data) => send(Uint8Array.from(data, (c) => c.charCodeAt(0))));
    if (!preview) {
      latest.current.handle?.({
        run: runPane,
        insert: (text) => view.paste(text),
        submit: (text) => send(encoder.encode(text + String.fromCharCode(13))),
        scrollToCommand: (command) => view.scrollToCommand(command),
      });
    }
    view.onResize((cols, rows) => {
      if (!preview) send(encodeControl({ type: 'resize', cols, rows }));
    });

    // A preview renders at the session's size, scaled down to the box.
    const scale = () => {
      const box = boxRef.current;
      if (!preview || !box) return;
      const el = view.element();
      const s = Math.min(1, box.clientWidth / (el.offsetWidth || 1), box.clientHeight / (el.offsetHeight || 1));
      host.style.transform = `scale(${s})`;
    };
    const boxObserver = new ResizeObserver(scale);
    if (preview && boxRef.current) boxObserver.observe(boxRef.current);

    const stop = (next: Status) => {
      ended = true;
      setStatus(next);
    };

    const retryLater = () => {
      setStatus({ kind: 'reconnecting' });
      const delay = Math.min(MAX_BACKOFF, 500 * 2 ** retries++);
      timer = setTimeout(() => void connect(false), delay);
    };

    function openSocket(ticket: string) {
      const socket = new WebSocket(socketUrl(ticket));
      const previous = ws;
      ws = socket;
      previous?.close();
      socket.binaryType = 'arraybuffer';
      socket.onmessage = (ev) => {
        if (ws !== socket) return;
        const m = decodeServerMessage(ev.data as string | ArrayBuffer);
        if (!m) return;
        if (m.kind === 'output') {
          view.write(decoder.decode(m.data, { stream: true }));
          return;
        }
        const msg = m.msg;
        if (msg.type === 'hello') {
          // The replay that follows redraws the screen from scratch.
          retries = 0;
          view.reset();
          decoder = new TextDecoder();
          if (preview) {
            view.resize(msg.cols, msg.rows);
            requestAnimationFrame(scale);
          } else {
            view.fit();
            const { cols, rows } = view.size();
            if (cols !== msg.cols || rows !== msg.rows) send(encodeControl({ type: 'resize', cols, rows }));
            if (latest.current.focused !== false) view.focus();
            send(encodeControl({ type: 'visible', visible: latest.current.visible !== false && document.hasFocus() }));
          }
          setStatus({ kind: 'live' });
        } else if (msg.type === 'exit') {
          latest.current.onRunning?.(false);
          if (latest.current.restartOnExit && !preview) {
            ended = true;
            latest.current.onExit?.(msg.code);
            void connect(true);
            return;
          }
          stop({ kind: 'exited', code: msg.code });
          latest.current.onExit?.(msg.code);
        } else if (msg.type === 'title') {
          latest.current.onTitle?.(msg.title);
        } else if (msg.type === 'command') {
          latest.current.onCommandRecord?.(msg.record);
        } else if (msg.type === 'result') {
          latest.current.onResult?.(msg.record);
        } else if (msg.type === 'capture') {
          latest.current.onCapture?.(msg.record);
        } else {
          latest.current.onAlerts?.(msg.alerts);
        }
      };
      socket.onclose = (ev) => {
        if (ws !== socket) return;
        ws = null;
        if (disposed || ended) return;
        if (ev.code === BACKPRESSURE_CLOSE) void connect(false);
        else if (ev.code === NO_SESSION_CLOSE) stop({ kind: 'ended' });
        // A plain close without an exit: another interactive view took the session.
        else if (ev.code === NORMAL_CLOSE) stop({ kind: 'detached' });
        else retryLater();
      };
    }

    async function connect(fresh: boolean) {
      clearTimeout(timer);
      ended = false;
      // A session id from a saved layout may belong to an earlier app run: then open a new shell instead.
      const restored = !fresh && !!sessionId && !sessionChecked;
      sessionChecked = true;
      try {
        let ticketed;
        if (fresh || !sessionId) {
          view.fit();
          const { cols, rows } = view.size();
          const { cwd, launch, profile, dir } = latest.current;
          ticketed = await openSession({ cols, rows, cwd, launch, profile, dir });
          if (disposed) {
            // Unmounted while opening (React strict mode remounts): nobody holds this session.
            void closeSession(ticketed.session).catch(() => {});
            return;
          }
          sessionId = ticketed.session;
          sessionRef.current = sessionId;
          latest.current.onSession?.(ticketed.session);
        } else {
          ticketed = await attachSession(sessionId, preview ? 'preview' : 'interactive');
          if (disposed) return;
        }
        openSocket(ticketed.ticket);
      } catch (err) {
        if (disposed) return;
        if (isSessionGone(err)) {
          if (restored && !preview) void connect(true);
          else stop({ kind: 'ended' });
        }
        else if (errorOf(err).kind === 'offline') retryLater();
        else stop({ kind: 'error', message: errorMessage(errorOf(err)) });
      }
    }

    controller.current = {
      session: () => sessionId,
      attach: (id) => {
        sessionId = id;
        sessionRef.current = id;
        ws?.close();
        ws = null;
        setStatus({ kind: 'connecting' });
        void connect(false);
      },
      restart: () => {
        setStatus({ kind: 'connecting' });
        void connect(true);
      },
      reattach: () => {
        setStatus({ kind: 'connecting' });
        void connect(false);
      },
    };
    void connect(false);

    return () => {
      disposed = true;
      clearTimeout(timer);
      boxObserver.disconnect();
      ws?.close();
      ws = null;
      controller.current = null;
      viewRef.current = null;
      if (!preview) latest.current.handle?.(null);
      view.dispose();
    };
  }, [preview]);

  useEffect(() => {
    if (options) viewRef.current?.setOptions(options);
  }, [options]);

  const triggersKey = JSON.stringify(props.triggers ?? []);
  useEffect(() => {
    viewRef.current?.setHighlights(compileTriggers(props.triggers));
  }, [triggersKey]);

  // Whether the user sees this pane: its tab shown and the window focused (a long command notifies otherwise).
  useEffect(() => {
    if (preview) return;
    const report = () => sendRef.current(encodeControl({ type: 'visible', visible: props.visible !== false && document.hasFocus() }));
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
    };
  }, [props.visible, preview]);

  // Matches in the earlier output (lines that left the scrollback), asked for as the query settles.
  useEffect(() => {
    const session = sessionRef.current;
    if (!finding || !findQuery || !session) {
      setEarlier(null);
      setShowEarlier(false);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      const params = { session, q: findQuery, ...(matchCase ? { case: '1' } : {}), ...(regex ? { regex: '1' } : {}) };
      request<{ count: number; hits: EarlierHit[] }>('GET', '/api/terminal/earlier', params).then(
        (r) => !stale && setEarlier(r.count ? r : null),
        () => !stale && setEarlier(null),
      );
    }, EARLIER_DELAY);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [finding, findQuery, matchCase, regex]);

  // Focus moved to this pane (another split pane had it): the keys come here.
  useEffect(() => {
    if (props.focused && !preview && !boxRef.current?.contains(document.activeElement)) viewRef.current?.focus();
  }, [props.focused]);

  const dim = Math.max(0, Math.min(80, options?.dimUnfocused ?? 0));
  const dimmed = !preview && props.focused === false && dim > 0;

  const step = (dir: 1 | -1) => {
    const view = viewRef.current;
    if (!view || !findQuery) return;
    const o = { caseSensitive: matchCase, regex };
    if (dir === 1) view.findNext(findQuery, o);
    else view.findPrevious(findQuery, o);
  };
  const closeFind = () => {
    setFinding(false);
    setFound({ index: -1, count: 0 });
    viewRef.current?.clearFind();
    viewRef.current?.focus();
  };
  // Typing or toggling an option searches again; an empty query clears the highlights.
  useEffect(() => {
    const view = viewRef.current;
    if (!finding || !view) return;
    if (findQuery) view.findNext(findQuery, { caseSensitive: matchCase, regex });
    else {
      view.clearFind();
      setFound({ index: -1, count: 0 });
    }
  }, [finding, findQuery, matchCase, regex]);
  const onFindKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  // A new `session` prop (not the one this pane just opened and reported) switches sessions.
  useEffect(() => {
    const c = controller.current;
    if (c && props.session && props.session !== c.session()) c.attach(props.session);
  }, [props.session]);

  const overlay = overlayOf(status, preview, controller);
  return (
    <div
      ref={boxRef}
      className={`terminal-pane${preview ? ' preview' : ''}${dimmed ? ' dimmed' : ''}`}
      style={dimmed ? ({ '--terminal-dim': dim / 100 } as CSSProperties) : undefined}
      {...(preview ? {} : { 'data-keys': 'own', 'data-keys-allow': appKeys.map((d) => d.id).join(' ') })}
    >
      <div ref={hostRef} className="terminal-host" />
      {finding && !preview && (
        <div className="terminal-find">
          <input
            ref={findInput}
            autoFocus
            type="search"
            value={findQuery}
            placeholder={t('terminal.find.placeholder')}
            aria-label={t('terminal.find.placeholder')}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={onFindKey}
          />
          <span className="terminal-find-count muted">
            {findQuery ? (found.count ? `${found.index >= 0 ? found.index + 1 : 0}/${found.count}` : t('terminal.find.none')) : ''}
          </span>
          <button type="button" className={`chip${matchCase ? ' chip-on' : ''}`} onClick={() => setMatchCase(!matchCase)} aria-pressed={matchCase} title={t('terminal.find.matchCase')}>
            Aa
          </button>
          <button type="button" className={`chip${regex ? ' chip-on' : ''}`} onClick={() => setRegex(!regex)} aria-pressed={regex} title={t('terminal.find.regex')}>
            .*
          </button>
          {earlier && (
            <button type="button" className={`chip${showEarlier ? ' chip-on' : ''}`} onClick={() => setShowEarlier(!showEarlier)} aria-pressed={showEarlier} title={t('terminal.find.earlierTitle')}>
              {t('terminal.find.earlier', { count: earlier.count })}
            </button>
          )}
          <IconButton icon="chevron-up" onClick={() => step(-1)} label={t('terminal.find.prev')} />
          <IconButton icon="chevron-down" onClick={() => step(1)} label={t('terminal.find.next')} />
          <IconButton icon="close" onClick={closeFind} label={t('terminal.find.close')} />
        </div>
      )}
      {finding && !preview && showEarlier && earlier && (
        <div className="terminal-earlier" role="list" aria-label={t('terminal.find.earlierTitle')}>
          {earlier.hits.map((h, i) => (
            <button key={i} type="button" className="terminal-earlier-hit" role="listitem" onClick={() => void copyNotify(h.line)}>
              {h.before.map((l, j) => (
                <span key={`b${j}`} className="muted">{l}</span>
              ))}
              <span className="terminal-earlier-line">{h.line}</span>
              {h.after.map((l, j) => (
                <span key={`a${j}`} className="muted">{l}</span>
              ))}
            </button>
          ))}
        </div>
      )}
      {hints && (
        <div className="terminal-hints" title={t('terminal.hints.help')}>
          {hints
            .filter((h) => h.label.startsWith(typed))
            .map((h) => (
              <span key={`${h.row}:${h.start}`} className={`terminal-hint terminal-hint-${h.kind}`} style={{ left: h.left, top: h.top }}>
                <b>{h.label.slice(0, typed.length)}</b>
                {h.label.slice(typed.length)}
              </span>
            ))}
        </div>
      )}
      {markMenu && (
        <ContextMenu
          at={markMenu.at}
          onClose={() => setMarkMenu(null)}
          items={[
            { id: 'copyCommand', label: t('terminal.mark.copyCommand'), icon: 'copy', disabled: !markMenu.mark.command, run: () => void copyNotify(markMenu.mark.command) },
            { id: 'copyOutput', label: t('terminal.mark.copyOutput'), disabled: markMenu.mark.running, run: () => void copyNotify(markMenu.mark.output()) },
            'sep',
            { id: 'rerun', label: t('terminal.mark.rerun'), icon: 'play', disabled: !markMenu.mark.command, run: () => sendRef.current(new TextEncoder().encode(markMenu.mark.command + String.fromCharCode(13))) },
            { id: 'insert', label: t('terminal.mark.insert'), disabled: !markMenu.mark.command, run: () => viewRef.current?.paste(markMenu.mark.command) },
          ]}
        />
      )}
      {overlay && <div className="terminal-overlay">{overlay}</div>}
      {dialogs.element}
    </div>
  );
}

function overlayOf(status: Status, preview: boolean, controller: { current: Controller | null }) {
  const action = (label: string, run: (c: Controller) => void) =>
    preview ? null : (
      <Button title={label} size="sm" onClick={() => controller.current && run(controller.current)}>
        {label}
      </Button>
    );
  switch (status.kind) {
    case 'live':
      return null;
    case 'connecting':
      return <span>{t('terminal.connecting')}</span>;
    case 'reconnecting':
      return <span>{t('terminal.reconnecting')}</span>;
    case 'exited':
      return (
        <>
          <span>{status.code === null ? t('terminal.exitedNoCode') : t('terminal.exited', { code: status.code })}</span>
          {action(t('terminal.restart'), (c) => c.restart())}
        </>
      );
    case 'ended':
      return (
        <>
          <span>{t('terminal.ended')}</span>
          {action(t('terminal.restart'), (c) => c.restart())}
        </>
      );
    case 'detached':
      return (
        <>
          <span>{t('terminal.detached')}</span>
          {action(t('terminal.reattach'), (c) => c.reattach())}
        </>
      );
    case 'error':
      return (
        <>
          <span className="terminal-error">{t('terminal.error', { message: status.message })}</span>
          {action(t('common.retry'), (c) => c.reattach())}
        </>
      );
  }
}
