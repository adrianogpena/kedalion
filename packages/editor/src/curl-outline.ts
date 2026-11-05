import { REST_BUILTIN_VARIABLES, restVarRefs } from '@kedalion/server-core/protocol';
import { type CurlCommand, curlCommands } from './curl-file';

/** One curl command of a file, as the outline shows it. `folder` is the " / " path Postman exports put in front of the name. */
export interface CurlItem {
  name: string;
  folder: string[];
  method: string;
  url: string;
  headers: number;
  /** 1-based line of the command's first line. */
  line: number;
  from: number;
  to: number;
}

const HEAD = 1200;
const SKIP_COMMENT = /^(?:disabled\b|collection:|converted from\b)/i;

/** The contiguous `#` comment block right above `from`, without the `#`. */
function commentBlock(text: string, from: number): string[] {
  const lines: string[] = [];
  let end = from - 1;
  while (end >= 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end).trim();
    if (!line.startsWith('#')) break;
    lines.push(line.replace(/^#+\s*/, ''));
    end = start - 1;
  }
  return lines.reverse();
}

const commentName = (text: string, from: number): string | undefined => commentBlock(text, from).find((l) => l !== '' && !SKIP_COMMENT.test(l));

/** The `# disabled header: Name: value` notes Postman exports leave above a command, whole lines such as `disabled header: A: b`. */
export function curlNotes(text: string, from: number): string[] {
  return commentBlock(text, from).filter((l) => /^disabled/i.test(l));
}

function methodOf(command: string): string {
  const head = command.slice(0, HEAD);
  const m = /(?:^|\s)(?:-X|--request)[\s=]+['"]?([A-Za-z]+)/.exec(head);
  if (m) return m[1]!.toUpperCase();
  if (/(?:^|\s)(?:-I|--head)(?=\s|$)/.test(head)) return 'HEAD';
  if (/(?:^|\s)(?:-G|--get)(?=\s|$)/.test(head)) return 'GET';
  return /(?:^|\s)(?:-d|-F|--data[\w-]*|--json|--form[\w-]*)(?=[\s=]|$)/.test(command) ? 'POST' : 'GET';
}

function urlOf(command: string): string {
  const head = command.slice(0, HEAD);
  const quoted = /(?:^|\s)(?:--url[\s=]+)?(['"])((?:https?:\/\/|\{\{|\/)[^'"\s]*)\1/.exec(head);
  if (quoted) return quoted[2]!;
  return /\s((?:https?:\/\/|\{\{)\S+)/.exec(head)?.[1] ?? '';
}

/** The requests of a curl file in order, found without parsing each one fully (cheap for multi-MB collections). */
export function curlOutline(text: string, commands: CurlCommand[] = curlCommands(text)): CurlItem[] {
  let line = 1;
  let scanned = 0;
  return commands.map((c) => {
    for (let i = text.indexOf('\n', scanned); i >= 0 && i < c.from; i = text.indexOf('\n', i + 1)) {
      line++;
      scanned = i + 1;
    }
    const method = methodOf(c.text);
    const url = urlOf(c.text);
    const parts = (commentName(text, c.from) ?? `${method} ${url}`).split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
    return {
      name: parts.pop() ?? `${method} ${url}`,
      folder: parts,
      method,
      url,
      headers: (c.text.match(/(?:^|\s)(?:-H|--header)(?=[\s=])/g) ?? []).length,
      line,
      from: c.from,
      to: c.to,
    };
  });
}

export interface CurlVariable {
  name: string;
  count: number;
  builtin: boolean;
}

/** Every `{{name}}` of the text with its number of uses, most used first. */
export function curlVariables(text: string): CurlVariable[] {
  const counts = new Map<string, number>();
  for (const ref of restVarRefs(text)) counts.set(ref.name, (counts.get(ref.name) ?? 0) + 1);
  const builtin = REST_BUILTIN_VARIABLES as readonly string[];
  return [...counts]
    .map(([name, count]) => ({ name, count, builtin: builtin.includes(name) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const BODY = /((?:--data-raw|--data-binary|--data|--json|-d)[\s=]+)'((?:[^']|'\\'')*)'/;

/** `command` with its single-quoted JSON body pretty-printed (2 spaces); null when there is none or it is not valid JSON. */
export function formatCurlBody(command: string): string | null {
  const m = BODY.exec(command);
  if (!m) return null;
  let value: unknown;
  try {
    value = JSON.parse(m[2]!.replaceAll("'\\''", "'"));
  } catch {
    return null;
  }
  const body = JSON.stringify(value, null, 2).replaceAll("'", "'\\''");
  const next = `${command.slice(0, m.index)}${m[1]}'${body}'${command.slice(m.index + m[0].length)}`;
  return next === command ? null : next;
}

const DATA_FLAG = /(?:^|\s)(?:--data-raw|--data-binary|--data-urlencode|--data|--json|-d)(?=[\s=])/g;

/** Offsets in `command` of the text inside the quotes of its only single-quoted data body; null when it has none, several, or another quoting. */
export function curlBodyRange(command: string): { from: number; to: number } | null {
  if ((command.match(DATA_FLAG) ?? []).length !== 1) return null;
  const m = BODY.exec(command);
  if (!m) return null;
  const from = m.index + m[1]!.length + 1;
  return { from, to: from + m[2]!.length };
}

/** A body as it sits between single quotes in a command. */
export const quoteCurlBody = (body: string): string => body.replaceAll("'", "'\''");
