/**
 * The prompt style as a bash-profile-like script, for the Settings editor only: `promptScript` writes a style as
 * text and `parsePromptScript` reads it back. Nothing here runs in a shell except the bodies of `prompt_<name>`
 * functions, which become custom segments.
 */
import {
  MAX_PROMPT_CUSTOMS,
  MAX_PROMPT_SEGMENTS,
  MAX_PROMPT_SYMBOL,
  PROMPT_COLORS,
  PROMPT_CUSTOM_NAME,
  PROMPT_SEGMENT_KINDS,
  type PromptColor,
  type PromptCustom,
  type PromptSegment,
  type PromptStyle,
  validPromptStyle,
} from './prompt.ts';

export type PromptScriptErrorCode =
  | 'syntax'
  | 'unknownVariable'
  | 'unknownSegment'
  | 'duplicateSegment'
  | 'unknownColor'
  | 'colorOfUnused'
  | 'unclosedFunction'
  | 'duplicateFunction'
  | 'functionName'
  | 'badSymbol'
  | 'tooMany'
  | 'missingSegments';

/** A problem on a 1-based line; `value` is the offending word when there is one. */
export interface PromptScriptError {
  line: number;
  code: PromptScriptErrorCode;
  value?: string;
}

const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

const colorText = (color: PromptColor | undefined, bold: boolean | undefined) => [color ?? 'default', ...(bold ? ['bold'] : [])].join(' ');

const segName = (s: PromptSegment) => (s.kind === 'custom' ? (s.name ?? '') : s.kind);

/** The style as script text (round-trips through `parsePromptScript`). */
export function promptScript(style: PromptStyle): string {
  const out = [
    '# Kedalion prompt. Edit the values; the preview follows as you type.',
    '# Segments, in order: cwd folder branch user host time status symbol newline,',
    '# or the name of a prompt_<name> function below.',
    `PROMPT_SEGMENTS=${quote(style.segments.map(segName).join(' '))}`,
    `PROMPT_SYMBOL=${quote(style.symbol)}`,
    '',
    `# Colors: ${PROMPT_COLORS.join(' ')}; add "bold".`,
  ];
  const done = new Set<string>();
  for (const s of style.segments) {
    const name = segName(s);
    if (s.kind === 'newline' || done.has(name)) continue;
    done.add(name);
    out.push(`PROMPT_COLOR_${name}=${quote(colorText(s.color, s.bold))}`);
    if (s.kind === 'symbol') out.push(`PROMPT_COLOR_symbol_error=${quote(colorText(s.errorColor ?? s.color, s.bold))}`);
  }
  out.push(
    '',
    '# Custom segments: a bash function prompt_<name>, closed by a } at the start of a line.',
    '# What it prints is shown; printing nothing hides the segment. $PROMPT_STATUS is the last exit code.',
    '# Runs in bash, Git Bash and zsh; PowerShell, fish and cmd leave custom segments out.',
  );
  const customs = style.customs ?? [];
  if (!customs.length) {
    out.push('# prompt_jdkinfo() {', '#   if [ -n "$JAVA_HOME" ]; then', '#     echo "jdk ${JAVA_HOME##*/}"', '#   fi', '# }');
  }
  for (const c of customs) out.push(`prompt_${c.name}() {`, ...(c.script ? c.script.split('\n') : []), '}', '');
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

/** A shell-style value: '...' literal, "..." with \" \\ \$ \` escapes, or a bare word (a # starts a comment). */
function unquote(raw: string): string | null {
  const v = raw.trim();
  if (v.startsWith("'")) {
    // 'a'\''b' joins pieces, as in a shell.
    const m = /^((?:'[^']*'|\\')+)\s*(#.*)?$/.exec(v);
    if (!m) return null;
    return m[1]!.replace(/\\'/g, "\u0000").replace(/'/g, '').replace(/\u0000/g, "'");
  }
  if (v.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"\s*(#.*)?$/.exec(v);
    if (!m) return null;
    return m[1]!.replace(/\\(["\\$`])/g, '$1');
  }
  const m = /^([^\s#'"]*)\s*(#.*)?$/.exec(v);
  return m ? m[1]! : null;
}

const FUNCTION_START = /^(?:function\s+)?prompt_(\w+)\s*\(\)\s*\{\s*$/;
const ASSIGNMENT = /^(?:export\s+)?(PROMPT_\w+)=(.*)$/;
const isColor = (v: string): v is PromptColor => (PROMPT_COLORS as readonly string[]).includes(v);

/** Reads the script; `style` is null when there is any error. */
export function parsePromptScript(text: string): { style: PromptStyle | null; errors: PromptScriptError[] } {
  const errors: PromptScriptError[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const vars = new Map<string, { value: string; line: number }>();
  const customs: PromptCustom[] = [];
  let fn: { name: string; line: number; body: string[] } | null = null;
  let code = false;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (fn) {
      if (/^\}\s*$/.test(raw)) {
        if (customs.some((c) => c.name === fn!.name)) errors.push({ line: fn.line, code: 'duplicateFunction', value: fn.name });
        else customs.push({ name: fn.name, script: fn.body.join('\n') });
        fn = null;
      } else fn.body.push(raw);
      return;
    }
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    code = true;
    const f = FUNCTION_START.exec(t);
    if (f) {
      if (!PROMPT_CUSTOM_NAME.test(f[1]!) || (PROMPT_SEGMENT_KINDS as readonly string[]).includes(f[1]!)) errors.push({ line, code: 'functionName', value: f[1] });
      fn = { name: f[1]!, line, body: [] };
      return;
    }
    const a = ASSIGNMENT.exec(t);
    if (!a) return void errors.push({ line, code: 'syntax' });
    const value = unquote(a[2]!);
    if (value === null) return void errors.push({ line, code: 'syntax' });
    vars.set(a[1]!, { value, line });
  });
  if (!code) return { style: { segments: [{ kind: 'user' }, { kind: 'symbol', errorColor: 'red' }], symbol: '$' }, errors };
  if (fn) errors.push({ line: (fn as { line: number }).line, code: 'unclosedFunction', value: (fn as { name: string }).name });
  if (customs.length > MAX_PROMPT_CUSTOMS) errors.push({ line: 1, code: 'tooMany' });

  const segVar = vars.get('PROMPT_SEGMENTS');
  const segments: PromptSegment[] = [];
  if (!segVar) errors.push({ line: 1, code: 'missingSegments' });
  else {
    const seen = new Set<string>();
    for (const word of segVar.value.split(/\s+/).filter(Boolean)) {
      if (word !== 'newline' && seen.has(word)) {
        errors.push({ line: segVar.line, code: 'duplicateSegment', value: word });
        continue;
      }
      seen.add(word);
      if ((PROMPT_SEGMENT_KINDS as readonly string[]).includes(word)) segments.push({ kind: word as PromptSegment['kind'] });
      else if (customs.some((c) => c.name === word)) segments.push({ kind: 'custom', name: word });
      else errors.push({ line: segVar.line, code: 'unknownSegment', value: word });
    }
    if (segments.length > MAX_PROMPT_SEGMENTS) errors.push({ line: segVar.line, code: 'tooMany' });
  }

  const symVar = vars.get('PROMPT_SYMBOL');
  const symbol = symVar?.value ?? '$';
  if (!symbol.trim() || [...symbol].length > MAX_PROMPT_SYMBOL || /[\u0000-\u001f\u007f]/.test(symbol)) errors.push({ line: symVar?.line ?? 1, code: 'badSymbol' });

  for (const [name, { value, line }] of vars) {
    if (name === 'PROMPT_SEGMENTS' || name === 'PROMPT_SYMBOL') continue;
    const m = /^PROMPT_COLOR_(\w+?)(_error)?$/.exec(name);
    if (!m) {
      errors.push({ line, code: 'unknownVariable', value: name });
      continue;
    }
    const [, target, error] = m;
    const seg = segments.find((s) => s.kind !== 'newline' && segName(s) === target);
    if (!seg || (error && seg.kind !== 'symbol')) {
      errors.push({ line, code: 'colorOfUnused', value: name });
      continue;
    }
    let color: PromptColor | undefined;
    let bold = false;
    for (const word of value.split(/\s+/).filter(Boolean)) {
      if (word === 'bold') bold = true;
      else if (isColor(word)) color = word;
      else errors.push({ line, code: 'unknownColor', value: word });
    }
    if (error) seg.errorColor = color;
    else {
      if (color) seg.color = color;
      if (bold) seg.bold = true;
    }
  }

  if (errors.length) return { style: null, errors: errors.sort((x, y) => x.line - y.line) };
  const style = validPromptStyle(customs.length ? { segments, symbol, customs } : { segments, symbol });
  return style ? { style, errors } : { style: null, errors: [{ line: 1, code: 'syntax' }] };
}
