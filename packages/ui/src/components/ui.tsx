import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { errorMessage, type ApiError } from '../api';
import { copyText } from '../hooks';
import { t } from '../i18n';
import { Button, IconButton } from './Button';
import { Icon, NavIcon } from './Icon';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'muted';

export function Badge({ tone = 'muted', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      <span className="badge-dot" />
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-label={t('common.loading')} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Page header: one slim row, title left, the screen's actions right (they wrap below when they don't fit). */
export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="content-head">
      <h1>{title}</h1>
      <span className="spacer" />
      {children}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, compact }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`error-banner${compact ? ' compact' : ''}`} role="alert">
      <div className="error-main">
        <Icon name="alert" />
        <div className="error-text">
          <strong>{errorMessage(error)}</strong>
        </div>
        <div className="error-actions">
          {error.detail && (
            <Button variant="ghost" size="sm" title={open ? t('common.hideDetails') : t('common.details')} onClick={() => setOpen(!open)}>
              {open ? t('common.hideDetails') : t('common.details')}
            </Button>
          )}
          {onRetry && (
            <Button size="sm" icon="refresh" title={t('common.retry')} onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      </div>
      {open && <pre className="error-detail">{error.detail}</pre>}
    </div>
  );
}

export function CopyButton({ text, label = t('common.copy') }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={done ? 'check' : 'copy'}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 1200);
        }
      }}
      title={label}
    >
      {label && <span>{done ? t('common.copied') : label}</span>}
    </Button>
  );
}

// Open modals, newest last. The command palette registers too (`useModalOpen`).
const openModals: object[] = [];

/** A Modal or the command palette is open: global shortcuts should stay quiet. */
export function isModalOpen(): boolean {
  return openModals.length > 0;
}

/** Counts the component as an open modal while it is mounted; returns whether it is the topmost one. */
export function useModalOpen(): () => boolean {
  const token = useRef({});
  useLayoutEffect(() => {
    const me = token.current;
    openModals.push(me);
    return () => {
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, []);
  return useCallback(() => openModals[openModals.length - 1] === token.current, []);
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog; Escape or a click on the backdrop closes it. Focuses its first field (or an
 * `autoFocus` element), keeps Tab inside and gives the focus back on close.
 * `large` is VS Code's modal editor (how it opens Settings): 80% of the window, up to 1400x900, a slim title bar
 * whose button or double-click maximizes it, and a body the content lays out itself.
 */
export function Modal({ title, onClose, children, footer, large }: { title: string; onClose: () => void; children?: ReactNode; footer?: ReactNode; large?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [maximized, setMaximized] = useState(false);
  const isTop = useModalOpen();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previous = useRef(document.activeElement);

  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = ['.modal-body', '.modal-foot', '.modal-head']
        .map((part) => el.querySelector(part)?.querySelector<HTMLElement>(FOCUSABLE))
        .find(Boolean);
      (first ?? el).focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTop()) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const prev = previous.current;
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && prev instanceof HTMLElement && prev.isConnected) prev.focus();
    };
  }, [isTop]);

  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !box.current) return;
    e.stopPropagation();
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first) e.preventDefault();
    else if (e.shiftKey && (active === first || active === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className={`modal${large ? ' modal-large' : ''}${large && maximized ? ' maximized' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <div className="modal-head" onDoubleClick={large ? (e) => !(e.target as HTMLElement).closest('button') && setMaximized((m) => !m) : undefined}>
          <h3>{title}</h3>
          {large && <span className="spacer" />}
          {large && (
            <IconButton
              icon={maximized ? 'restore' : 'maximize'}
              label={t(maximized ? 'common.restore' : 'common.maximize')}
              onClick={() => setMaximized((m) => !m)}
            />
          )}
          <IconButton icon="close" label={t('common.close')} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  okLabel?: string;
  /** Red OK button; Cancel gets the focus. */
  danger?: boolean;
  /** Dismisses the dialog (resolves false) when aborted. */
  signal?: AbortSignal;
}

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  /** A message shown under the input; OK stays disabled while it returns one. */
  validate?(value: string): string | null;
}

export interface ChoiceOptions {
  title: string;
  body?: ReactNode;
  /** Buttons after Cancel, in order; the first one has the focus. */
  choices: Array<{ id: string; label: string; danger?: boolean }>;
  /** A checkbox under the body; `onChange` gets its state each time it is toggled. */
  checkbox?: { label: string; onChange: (checked: boolean) => void };
}

type DialogRequest =
  | { id: number; kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void }
  | { id: number; kind: 'choice'; opts: ChoiceOptions; resolve: (id: string | null) => void };

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions; onDone: (ok: boolean) => void }) {
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(false)}
      footer={
        <>
          <Button title={t('dialog.cancel')} onClick={() => onDone(false)} autoFocus={opts.danger}>{t('dialog.cancel')}</Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} title={opts.okLabel ?? t('dialog.ok')} onClick={() => onDone(true)} autoFocus={!opts.danger}>
            {opts.okLabel ?? t('dialog.ok')}
          </Button>
        </>
      }
    >
      {typeof opts.body === 'string' ? <p>{opts.body}</p> : opts.body}
    </Modal>
  );
}

function ChoiceDialog({ opts, onDone }: { opts: ChoiceOptions; onDone: (id: string | null) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button title={t('dialog.cancel')} onClick={() => onDone(null)}>{t('dialog.cancel')}</Button>
          {opts.choices.map((c, i) => (
            <Button title={c.label} key={c.id} variant={c.danger ? 'danger' : i === 0 ? 'primary' : 'default'} onClick={() => onDone(c.id)} autoFocus={i === 0}>
              {c.label}
            </Button>
          ))}
        </>
      }
    >
      {typeof opts.body === 'string' ? <p>{opts.body}</p> : opts.body}
      {opts.checkbox && (
        <label className="row">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              opts.checkbox!.onChange(e.target.checked);
            }}
          />
          <span>{opts.checkbox.label}</span>
        </label>
      )}
    </Modal>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? '');
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => input.current?.select(), []);
  const message = opts.validate?.(value) ?? null;
  return (
    <Modal
      title={opts.title}
      onClose={() => onDone(null)}
      footer={
        <>
          <Button title={t('dialog.cancel')} onClick={() => onDone(null)}>{t('dialog.cancel')}</Button>
          <Button variant="primary" title={t('dialog.ok')} type="submit" form={id} disabled={message !== null}>{t('dialog.ok')}</Button>
        </>
      }
    >
      <form
        id={id}
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (message === null) onDone(value);
        }}
      >
        <label htmlFor={`${id}-input`}>{opts.label}</label>
        <input ref={input} id={`${id}-input`} value={value} autoFocus aria-invalid={message !== null} onChange={(e) => setValue(e.target.value)} />
        {message !== null && <span className="field-error">{message}</span>}
      </form>
    </Modal>
  );
}

let dialogIds = 0;

/**
 * Promise-based confirm, prompt and choice dialogs. Render `element` once in the component; all
 * resolve on OK, Cancel or Escape (confirm → false, prompt and choice → null), also when the
 * component unmounts.
 */
export function useDialogs(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  choose: (opts: ChoiceOptions) => Promise<string | null>;
  element: ReactNode;
} {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const pending = useRef<DialogRequest[]>([]);

  const push = useCallback((req: DialogRequest) => {
    pending.current.push(req);
    setQueue((q) => [...q, req]);
  }, []);
  const settle = (req: DialogRequest, value: boolean | string | null) => {
    pending.current = pending.current.filter((r) => r !== req);
    setQueue((q) => q.filter((r) => r !== req));
    if (req.kind === 'confirm') req.resolve(value === true);
    else req.resolve(typeof value === 'string' ? value : null);
  };

  useEffect(() => () => {
    for (const req of pending.current) {
      if (req.kind === 'confirm') req.resolve(false);
      else req.resolve(null);
    }
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (opts.signal?.aborted) return resolve(false);
        const req: DialogRequest = { id: ++dialogIds, kind: 'confirm', opts, resolve };
        push(req);
        opts.signal?.addEventListener(
          'abort',
          () => {
            if (!pending.current.includes(req)) return;
            pending.current = pending.current.filter((r) => r !== req);
            setQueue((q) => q.filter((r) => r !== req));
            resolve(false);
          },
          { once: true },
        );
      }),
    [push],
  );
  const prompt = useCallback((opts: PromptOptions) => new Promise<string | null>((resolve) => push({ id: ++dialogIds, kind: 'prompt', opts, resolve })), [push]);

  const choose = useCallback((opts: ChoiceOptions) => new Promise<string | null>((resolve) => push({ id: ++dialogIds, kind: 'choice', opts, resolve })), [push]);

  const req = queue[0];
  const element = !req ? null : req.kind === 'confirm'
    ? <ConfirmDialog key={req.id} opts={req.opts} onDone={(ok) => settle(req, ok)} />
    : req.kind === 'choice'
      ? <ChoiceDialog key={req.id} opts={req.opts} onDone={(id) => settle(req, id)} />
      : <PromptDialog key={req.id} opts={req.opts} onDone={(value) => settle(req, value)} />;
  return { confirm, prompt, choose, element };
}

export type { IconName } from '../icons';

/** The app mark (Anvil spark, docs/ICONS.md): anvil in `.brand-mark` colour (accent), spark in `--brand-spark`. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="8 9 48 48" aria-hidden="true">
      <g fill="var(--brand-spark)">
        <path d="M32 10l2.2 6.3 6.3 2.2-6.3 2.2L32 27l-2.2-6.3-6.3-2.2 6.3-2.2z" />
        <circle cx="44" cy="14" r="1.6" />
        <circle cx="21" cy="23" r="1.3" />
      </g>
      <path d="M10 31h44v6h-8c-2 0-3 2-3 4v6h5v6H22v-6h5v-6c0-2-1-4-3-4-6 0-11-2-14-6z" fill="currentColor" />
    </svg>
  );
}

export { Icon, NavIcon };
