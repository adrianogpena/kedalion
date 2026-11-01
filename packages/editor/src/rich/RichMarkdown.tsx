import '@milkdown/prose/view/style/prosemirror.css';
import './rich.css';
import { defaultValueCtx, Editor, editorViewCtx, parserCtx, rootCtx, serializerCtx } from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { history } from '@milkdown/plugin-history';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import type { Node } from '@milkdown/prose/model';
import { TextSelection } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { frontmatterEntries, frontmatterTable } from '../markdown';
import { htmlView, imageView, refreshHtml, userEditPlugin } from './base';
import { type RichApi, type RichCommandId, type RichHost, runRichCommand } from './commands';
import { FEATURES } from './features';
import { EXTERNAL_META, frontmatterYaml, richValue, splitFrontmatter } from './frontmatter';
import { FindBar, findPlugin, selectedText } from './find';
import { refreshLineNumbers } from './lineNumbers';

export interface RichMarkdownHandle {
  /** Runs a command through the features' handlers; false when none took it or the pane is not ready. */
  run(id: RichCommandId): boolean;
}

export interface RichMarkdownProps {
  value: string;
  /** Called only after a user edit; until then the host keeps its text byte for byte. */
  onChange(value: string): void;
  host: RichHost;
  autoFocus?: boolean;
  /** Cursor (document position) and scroll fraction (0..1) to restore once the pane is ready. */
  initialView?: RichViewState;
  /** Fires when the cursor moves or the pane scrolls. */
  onViewState?(state: RichViewState): void;
}

export interface RichViewState {
  pos: number;
  scroll: number;
}

/** The frontmatter block, read-only above the document: a key/value table, or the raw YAML when it has no keys. */
function Frontmatter({ front }: { front: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const yaml = frontmatterYaml(front) ?? '';
    const entries = frontmatterEntries(yaml);
    if (entries) {
      box.current?.replaceChildren(frontmatterTable(entries));
    } else {
      const pre = document.createElement('pre');
      pre.textContent = yaml;
      box.current?.replaceChildren(pre);
    }
  }, [front]);
  return <div ref={box} className="md-rich-front" contentEditable={false} />;
}

/** The Milkdown pane: CommonMark + GFM with history, the frontmatter kept aside, the features of `FEATURES`. */
export const RichMarkdown = forwardRef<RichMarkdownHandle, RichMarkdownProps>(function RichMarkdown({ value, onChange, host, autoFocus, initialView, onViewState }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const viewState = useRef({ initialView, onViewState });
  viewState.current = { initialView, onViewState };
  /** True until a restore has landed, so the initial scroll/selection does not overwrite the saved state. */
  const restoring = useRef(true);
  const [api, setApi] = useState<RichApi | null>(null);
  const [front, setFront] = useState(() => splitFrontmatter(value).front);
  const [finding, setFinding] = useState(false);
  const [seed, setSeed] = useState('');
  const latest = useRef({ value, onChange, host });
  latest.current = { value, onChange, host };
  /** The text last parsed or emitted, the text the document was parsed from, its frontmatter and that parsed document. */
  const sync = useRef<{ text: string; original: string; front: string; baseDoc: Node | null }>({ text: value, original: value, front, baseDoc: null });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let cancelled = false;
    let editor: Editor | undefined;
    let ctxOf: Ctx | undefined;
    const initial = latest.current.value;
    const split = splitFrontmatter(initial);
    sync.current = { text: initial, original: initial, front: split.front, baseDoc: null };
    const emit = (view: EditorView) => {
      const s = sync.current;
      if (!ctxOf || !s.baseDoc) return;
      const ctx = ctxOf;
      const next = richValue(s.original, s.front, view.state.doc.eq(s.baseDoc), () => ctx.get(serializerCtx)(view.state.doc));
      if (next === s.text) return;
      s.text = next;
      latest.current.onChange(next);
    };
    const make = Editor.make()
      .config((ctx) => {
        ctxOf = ctx;
        ctx.set(rootCtx, el);
        ctx.set(defaultValueCtx, split.body);
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(imageView(() => latest.current.host.resolveImage))
      .use(htmlView(() => latest.current.host.resolveImage))
      .use(findPlugin)
      .use(userEditPlugin(emit));
    for (const f of FEATURES) if (f.plugins) make.use(f.plugins);
    make.create().then((ed) => {
      if (cancelled) {
        void ed.destroy();
        return;
      }
      editor = ed;
      ed.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        sync.current.baseDoc = view.state.doc;
        setApi({ view, ctx, get host() { return latest.current.host; }, getMarkdown: () => sync.current.text });
        const restore = viewState.current.initialView;
        if (restore) {
          const pos = Math.min(restore.pos, view.state.doc.content.size);
          view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))).setMeta('addToHistory', false));
          const apply = () => {
            const box = scroller.current;
            if (box) box.scrollTop = restore.scroll * (box.scrollHeight - box.clientHeight);
          };
          apply();
          requestAnimationFrame(apply);
        }
        if (autoFocus) view.focus();
        if (restore) requestAnimationFrame(() => { restoring.current = false; });
        else restoring.current = false;
      });
    }, (err: unknown) => console.error('Markdown editor failed to start', err));
    return () => {
      cancelled = true;
      setApi(null);
      void editor?.destroy();
    };
    // Mounted once; later values arrive through the sync effect below.
  }, []);

  // An outside change (reload, save normalizing the text, another editor): parse it without counting it as an edit.
  useEffect(() => {
    const s = sync.current;
    if (!api || value === s.text) return;
    const split = splitFrontmatter(value);
    const doc = api.ctx.get(parserCtx)(split.body);
    const { view } = api;
    // No base while dispatching: follow-up transactions of the replacement are not edits.
    sync.current = { text: value, original: value, front: split.front, baseDoc: null };
    if (!doc.eq(view.state.doc)) {
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(EXTERNAL_META, true).setMeta('addToHistory', false));
    }
    sync.current.baseDoc = view.state.doc;
    setFront(split.front);
  }, [value, api]);

  useEffect(() => {
    const box = scroller.current;
    if (!api || !box) return;
    const report = () => {
      if (restoring.current) return;
      const range = box.scrollHeight - box.clientHeight;
      viewState.current.onViewState?.({ pos: api.view.state.selection.head, scroll: range > 0 ? box.scrollTop / range : 0 });
    };
    box.addEventListener('scroll', report);
    box.addEventListener('keyup', report);
    box.addEventListener('pointerup', report);
    return () => {
      box.removeEventListener('scroll', report);
      box.removeEventListener('keyup', report);
      box.removeEventListener('pointerup', report);
    };
  }, [api]);

  const resolveImage = host.resolveImage;
  useEffect(() => {
    if (api && root.current) refreshHtml(root.current, resolveImage);
  }, [api, resolveImage]);

  const lineNumbers = host.settings.lineNumbers;
  useEffect(() => {
    if (api) refreshLineNumbers(api.view);
  }, [api, lineNumbers]);

  useImperativeHandle(ref, () => ({ run: (id) => (api ? runRichCommand(FEATURES, id, api) : false) }), [api]);

  const { headingLinks, lineBreaks } = host.settings;
  const cls = ['md-rich', headingLinks && 'md-heading-links', lineNumbers && 'md-line-numbers', lineBreaks && 'md-line-breaks'].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      onKeyDown={(e) => {
        if (!api || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
        e.preventDefault();
        e.stopPropagation();
        setSeed(selectedText(api.view));
        setFinding(true);
      }}
    >
      {api && finding && <FindBar view={api.view} seed={seed} onClose={() => { setFinding(false); api.view.focus(); }} />}
      {api && FEATURES.map((f, i) => {
        const Overlay = f.Overlay;
        return Overlay ? <Overlay key={i} api={api} /> : null;
      })}
      <div ref={scroller} className="md-rich-scroll">
        <div className="md-rich-doc markdown">
          {front && <Frontmatter front={front} />}
          <div ref={root} className="md-rich-root" />
        </div>
      </div>
    </div>
  );
});
