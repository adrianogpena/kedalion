import { foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { curlCommands } from './curl-file';

const FLAG = /(^|\s)(--?[A-Za-z][\w.-]*)(?=[\s=]|$)/g;
const LEADING = /^\s*(?:\$\s+)?(?:curl(?:\.exe)?\b|--?[A-Za-z])/;
const flagMark = Decoration.mark({ class: 'cm-curl-flag' });
const methodMark = Decoration.mark({ class: 'cm-curl-method' });

function decorate(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    let pos = Math.max(from, last + 1);
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      last = line.to;
      if (!LEADING.test(line.text)) continue;
      for (const m of line.text.matchAll(FLAG)) {
        const start = line.from + m.index + m[1]!.length;
        builder.add(start, start + m[2]!.length, flagMark);
      }
      const method = /(?:-X|--request)\s+(['"]?)([A-Z]+)\1/.exec(line.text);
      if (method) {
        const start = line.from + method.index + method[0].length - method[2]!.length - method[1]!.length;
        builder.add(start, start + method[2]!.length, methodMark);
      }
    }
  }
  return builder.finish();
}

/** Marks the flags (`--header`, `-X`) at the start of a curl command's lines and the method after `-X`. */
export function curlHighlight(): Extension {
  return [
    ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = decorate(u.view);
      }
    }, { decorations: (p) => p.decorations }),
    EditorView.baseTheme({
      '.cm-curl-flag': { color: 'var(--accent)' },
      '.cm-curl-method': { color: 'var(--warn)', fontWeight: '600' },
    }),
  ];
}

/** Each curl command folds to its first line. The command list is cached per document. */
export function curlFolding(): Extension {
  let cachedDoc: unknown;
  let cached: Array<{ from: number; to: number }> = [];
  const service = foldService.of((state, lineStart) => {
    if (cachedDoc !== state.doc) {
      cachedDoc = state.doc;
      cached = curlCommands(state.doc.toString());
    }
    const command = cached.find((c) => c.from === lineStart);
    if (!command) return null;
    const first = state.doc.lineAt(command.from);
    return command.to > first.to ? { from: first.to, to: command.to } : null;
  });
  return [service, foldGutter(), keymap.of(foldKeymap)];
}
