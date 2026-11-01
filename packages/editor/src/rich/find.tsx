import './find.css';
import type { MilkdownPlugin } from '@milkdown/ctx';
import type { Node } from '@milkdown/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view';
import { $prose } from '@milkdown/utils';
import { createT, IconButton } from '@kedalion/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

type Label = 'explorer.md.find' | 'explorer.md.findNext' | 'explorer.md.findPrev' | 'explorer.md.findNone' | 'explorer.md.findClose';
/** The labels are registered by the explorer view (`packages/view-explorer/src/i18n.ts`). */
const t = createT<Label>();

interface FindState {
  query: string;
  current: number;
}

const findKey = new PluginKey<FindState>('kedalion.richFind');

interface Match {
  from: number;
  to: number;
}

/** Case-insensitive matches inside single text nodes. */
export function findMatches(doc: Node, query: string): Match[] {
  const out: Match[] = [];
  const q = query.toLowerCase();
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text.toLowerCase();
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push({ from: pos + i, to: pos + i + q.length });
  });
  return out;
}

/** Highlights the matches of the find bar's query; the current one is marked apart. */
export const findPlugin: MilkdownPlugin = $prose(() => new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ query: '', current: -1 }),
    apply: (tr, prev) => (tr.getMeta(findKey) as FindState | undefined) ?? prev,
  },
  props: {
    decorations(state) {
      const s = findKey.getState(state);
      if (!s?.query) return null;
      return DecorationSet.create(
        state.doc,
        findMatches(state.doc, s.query).map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'md-find-hit md-find-current' : 'md-find-hit' })),
      );
    },
  },
}));

function setFind(view: EditorView, state: FindState) {
  view.dispatch(view.state.tr.setMeta(findKey, state).setMeta('addToHistory', false));
}

function reveal(view: EditorView, m: Match) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).setMeta('addToHistory', false));
  // The view is not focused (the find input is), so ProseMirror's own scroll does not run: scroll the match itself.
  const at = view.domAtPos(m.from);
  const el = at.node.nodeType === 1 ? (at.node as HTMLElement) : at.node.parentElement;
  el?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

/** The selected text when it is a short single line; seeds the find query. */
export function selectedText(view: EditorView): string {
  const { from, to, empty } = view.state.selection;
  if (empty || to - from > 200) return '';
  const text = view.state.doc.textBetween(from, to, '\n');
  return text.includes('\n') ? '' : text.trim();
}

/** Find bar of the rich pane: searches only the document, not the page. `seed` changes on every Ctrl+F. */
export function FindBar({ view, seed, onClose }: { view: EditorView; seed: string; onClose(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(seed);
  const [current, setCurrent] = useState(-1);
  const matches = useMemo(() => findMatches(view.state.doc, query), [view, query, view.state.doc]);

  useEffect(() => {
    if (seed) {
      setQuery(seed);
      setCurrent(-1);
    }
    input.current?.focus();
    input.current?.select();
  }, [seed]);

  useEffect(() => {
    setFind(view, { query, current });
  }, [view, query, current, matches]);

  useEffect(() => () => setFind(view, { query: '', current: -1 }), [view]);

  const go = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    setCurrent(next);
    reveal(view, matches[next]!);
    input.current?.focus();
  };

  return (
    <div className="md-find" role="search">
      <input
        ref={input}
        type="search"
        value={query}
        placeholder={t('explorer.md.find')}
        aria-label={t('explorer.md.find')}
        onChange={(e) => {
          setQuery(e.target.value);
          setCurrent(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="md-find-count muted">{query ? (matches.length ? `${current >= 0 ? current + 1 : 0}/${matches.length}` : t('explorer.md.findNone')) : ''}</span>
      <IconButton size="xs" icon="chevron-up" label={t('explorer.md.findPrev')} onClick={() => go(-1)} />
      <IconButton size="xs" icon="chevron-down" label={t('explorer.md.findNext')} onClick={() => go(1)} />
      <IconButton size="xs" icon="close" label={t('explorer.md.findClose')} onClick={onClose} />
    </div>
  );
}
