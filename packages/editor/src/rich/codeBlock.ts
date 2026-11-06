import './codeBlock.css';
import { copyText } from '@kedalion/ui';
import { tryT } from '@kedalion/ui/i18n';
import { highlightTree } from '@lezer/highlight';
import { codeBlockSchema } from '@milkdown/preset-commonmark';
import type { Node } from '@milkdown/prose/model';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import { $prose, $view } from '@milkdown/utils';
import { langOfFile } from '../fileKinds';
import { type Lang, langLabel, parserOf } from '../languages';
import { highlightStyle } from '../theme';
import type { RichFeature } from './commands';

/** Code blocks longer than this stay plain text. */
export const MAX_HIGHLIGHT = 20_000;

const ALIASES: Record<string, Lang> = {
  shell: 'shell', shellscript: 'shell', sh: 'shell', bash: 'shell', zsh: 'shell', console: 'shell',
  'c#': 'csharp', 'c++': 'cpp', golang: 'go', docker: 'dockerfile', text: 'text', txt: 'text', plaintext: 'text', plain: 'text',
};
const LANGS = new Set<string>([
  'sql', 'json', 'shell', 'java', 'markdown', 'xml', 'text', 'javascript', 'typescript', 'css', 'html', 'python', 'yaml', 'toml',
  'properties', 'rust', 'go', 'c', 'cpp', 'csharp', 'kotlin', 'diff', 'dockerfile',
]);

/** The fence's language name: the first word of the info string, lower case. */
export const fenceName = (info: string | null | undefined) => (info ?? '').trim().split(/\s+/)[0]!.toLowerCase();

/** The editor language a fence names (an id, alias or file extension); null when unknown or empty. */
export function resolveLang(info: string | null | undefined): Lang | null {
  const name = fenceName(info);
  if (!name) return null;
  if (LANGS.has(name)) return name as Lang;
  if (ALIASES[name]) return ALIASES[name];
  const byExt = langOfFile('x.' + name);
  return byExt === 'text' ? null : byExt;
}

/** Whether a block of this language and size gets highlighted. */
export const highlightable = (lang: Lang | null, size: number) => lang !== null && size <= MAX_HIGHLIGHT && parserOf(lang) !== null;

/** Highlight ranges (offsets into `text`) and their classes; empty for unknown languages or long blocks. */
export function highlightRanges(info: string | null | undefined, text: string): { from: number; to: number; cls: string }[] {
  const lang = resolveLang(info);
  if (!highlightable(lang, text.length)) return [];
  const out: { from: number; to: number; cls: string }[] = [];
  highlightTree(parserOf(lang!)!.parse(text), highlightStyle, (from, to, cls) => out.push({ from, to, cls }));
  return out;
}

/** The languages the selector offers, as written into the fence (plain text writes none). */
export const PICKER_LANGS: readonly string[] = [
  'text', 'shell', 'c', 'cpp', 'csharp', 'css', 'diff', 'dockerfile', 'go', 'html', 'java', 'javascript', 'json', 'kotlin',
  'markdown', 'mermaid', 'properties', 'python', 'rust', 'sql', 'toml', 'typescript', 'xml', 'yaml',
];
const pickerLabel = (id: string) => (id === 'text' ? tryT('explorer.md.plainText') ?? 'Plain text' : id === 'mermaid' ? 'Mermaid' : langLabel(id as Lang));

/** The selector's value for a fence: its canonical language, or the raw name when unknown. */
export function pickerValue(info: string | null | undefined): string {
  const name = fenceName(info);
  if (!name) return 'text';
  if (name === 'mermaid') return 'mermaid';
  return resolveLang(name) ?? name;
}

const cache = new WeakMap<Node, { from: number; to: number; cls: string }[]>();
function decorate(doc: Node): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return true;
    let ranges = cache.get(node);
    if (!ranges) {
      ranges = highlightRanges(String(node.attrs.language ?? ''), node.textContent);
      cache.set(node, ranges);
    }
    for (const r of ranges) decos.push(Decoration.inline(pos + 1 + r.from, pos + 1 + r.to, { class: r.cls }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const highlightKey = new PluginKey<DecorationSet>('md-code-highlight');
const highlightPlugin = $prose(() => new Plugin<DecorationSet>({
  key: highlightKey,
  state: {
    init: (_, state) => decorate(state.doc),
    apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
  },
  props: { decorations: (state) => highlightKey.getState(state) },
}));

/** The code block: a language selector above a horizontally scrolling `<pre>`. */
const codeBlockView = $view(codeBlockSchema.node, () => (initial, view, getPos) => {
  let node = initial;
  const dom = document.createElement('div');
  dom.className = 'md-rich-code';
  const bar = document.createElement('div');
  bar.className = 'md-rich-code-bar';
  bar.contentEditable = 'false';
  const select = document.createElement('select');
  select.className = 'md-rich-code-lang';
  select.title = tryT('explorer.md.language') ?? 'Language';
  select.setAttribute('aria-label', select.title);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'md-rich-code-copy';
  const copyLabel = tryT('explorer.md.copyCode') ?? 'Copy code';
  copy.title = copyLabel;
  copy.setAttribute('aria-label', copyLabel);
  copy.textContent = copyLabel;
  copy.addEventListener('mousedown', (e) => e.preventDefault());
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void copyText(node.textContent).then((ok) => {
      if (!ok) return;
      copy.textContent = tryT('explorer.md.codeCopied') ?? 'Copied';
      setTimeout(() => { copy.textContent = copyLabel; }, 1200);
    });
  });
  bar.append(select, copy);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.spellcheck = false;
  pre.append(code);
  dom.append(bar, pre);

  const fill = () => {
    const value = pickerValue(String(node.attrs.language ?? ''));
    const ids = PICKER_LANGS.includes(value) ? PICKER_LANGS : [...PICKER_LANGS, value];
    select.replaceChildren(...ids.map((id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = PICKER_LANGS.includes(id) ? pickerLabel(id) : id;
      return opt;
    }));
    select.value = value;
  };
  fill();
  select.addEventListener('change', () => {
    const pos = getPos();
    if (pos === undefined) return;
    const language = select.value === 'text' ? '' : select.value;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language }));
    view.focus();
  });

  return {
    dom,
    contentDOM: code,
    update(next) {
      if (next.type !== node.type) return false;
      const changed = next.attrs.language !== node.attrs.language;
      node = next;
      if (changed) fill();
      return true;
    },
    stopEvent: (e) => bar.contains(e.target as globalThis.Node),
    ignoreMutation: (m) => !code.contains(m.target),
  };
});

/** Code block view: language selector and highlighting with the editor's parsers and theme. */
export const codeBlockFeature: RichFeature = { plugins: [highlightPlugin, codeBlockView] };
