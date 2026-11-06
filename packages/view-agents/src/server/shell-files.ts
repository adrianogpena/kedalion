import { posix, win32 } from 'node:path';
import type { AgentTraceShellFile } from '../protocol.ts';

const SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n']);
const REDIRECT = /^(?:\d?>>?|&>>?)(.*)$/;
const NULL_SINKS = new Set(['/dev/null', 'nul', 'NUL', '$null']);

/** Splits a shell line into words and separators, honoring quotes. */
function tokenize(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let has = false;
  const flush = () => {
    if (has) out.push(cur);
    cur = '';
    has = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = '';
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\n' || c === ';') {
      flush();
      out.push(c);
    } else if (c === '&' || c === '|') {
      flush();
      const two = command[i + 1] === c;
      if (c === '&' && command[i + 1] === '>') {
        cur = '&>';
        has = true;
        i++;
        if (command[i + 1] === '>') {
          cur += '>';
          i++;
        }
        flush();
      } else {
        out.push(two ? c + c : c);
        if (two) i++;
      }
    } else if (/\s/.test(c)) flush();
    else {
      cur += c;
      has = true;
    }
  }
  flush();
  return out;
}

const isFlag = (w: string) => w.startsWith('-') && w.length > 1;
const isGlob = (w: string) => /[*?[\]{}$`]/.test(w);

function resolveIn(cwd: string | undefined, p: string): string {
  if (!cwd) return p;
  const win = /^[A-Za-z]:|\\/.test(cwd);
  const lib = win ? win32 : posix;
  return lib.isAbsolute(p) ? p : lib.resolve(cwd, p);
}

/** Files a Bash command writes, edits, deletes, moves or restores (best effort: common commands and redirections only). */
export function shellFileOps(command: string, cwd?: string): AgentTraceShellFile[] {
  const words = tokenize(command);
  const out: AgentTraceShellFile[] = [];
  const add = (op: AgentTraceShellFile['op'], p: string | undefined) => {
    if (!p || isGlob(p) || NULL_SINKS.has(p) || /^&\d?$/.test(p)) return;
    out.push({ op, path: resolveIn(cwd, p) });
  };
  let seg: string[] = [];
  const run = () => {
    const w = seg;
    seg = [];
    if (w.length === 0) return;
    const rest: string[] = [];
    for (let i = 1; i < w.length; i++) {
      const word = w[i]!;
      const m = REDIRECT.exec(word);
      if (m && !/^\d>&\d?$/.test(word)) {
        const target = m[1] || w[++i];
        add('write', target);
      } else rest.push(word);
    }
    const cmdWord = w[0]!;
    const redirectOnly = REDIRECT.exec(cmdWord);
    if (redirectOnly) {
      add('write', redirectOnly[1] || w[1]);
      return;
    }
    const cmd = cmdWord.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
    const args = rest.filter((a) => !isFlag(a));
    switch (cmd) {
      case 'rm':
      case 'rmdir':
      case 'del':
      case 'erase':
      case 'remove-item':
      case 'ri':
        for (const a of args) add('delete', a);
        break;
      case 'mv':
      case 'move':
      case 'move-item':
      case 'mi':
        if (args.length >= 2) {
          for (const a of args.slice(0, -1)) add('move-from', a);
          add('move-to', args[args.length - 1]);
        }
        break;
      case 'cp':
      case 'copy':
      case 'copy-item':
      case 'cpi':
        if (args.length >= 2) add('write', args[args.length - 1]);
        break;
      case 'touch':
      case 'tee':
        for (const a of args) add('write', a);
        break;
      case 'sed':
        if (rest.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) for (const a of args.slice(1)) add('edit', a);
        break;
      case 'git': {
        const sub = args[0];
        const afterDashes = rest.indexOf('--');
        if (sub === 'checkout' && afterDashes >= 0) for (const a of rest.slice(afterDashes + 1)) add('restore', a);
        else if (sub === 'restore') for (const a of args.slice(1)) add('restore', a);
        else if (sub === 'rm') for (const a of args.slice(1)) add('delete', a);
        else if (sub === 'mv' && args.length >= 3) {
          for (const a of args.slice(1, -1)) add('move-from', a);
          add('move-to', args[args.length - 1]);
        }
        break;
      }
      default:
    }
  };
  for (const word of words) {
    if (SEPARATORS.has(word)) run();
    else seg.push(word);
  }
  run();
  return out;
}
