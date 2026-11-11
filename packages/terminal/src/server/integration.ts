/// <reference path="./integration/scripts.d.ts" />
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROMPT_STYLE, type PromptStyle, promptSpec } from '../prompt.ts';
import type { ShellId } from '../protocol.ts';
// Text imports: `bun build --compile` inlines them, so the exe carries the scripts and writes them out at runtime.
import bashScript from './integration/bash.sh' with { type: 'text' };
import fishScript from './integration/fish.fish' with { type: 'text' };
import pwshScript from './integration/pwsh.ps1' with { type: 'text' };
import zshForward from './integration/zsh-forward.zsh' with { type: 'text' };
import zshrcScript from './integration/zshrc.zsh' with { type: 'text' };

/** Shells that get an integration script. */
export type IntegratedShell = 'bash' | 'git-bash' | 'zsh' | 'fish' | 'powershell' | 'pwsh' | 'cmd';

const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** Files written under the integration dir: relative path → content. */
export function integrationFiles(): Record<string, string> {
  const files: Record<string, string> = {
    'bash.sh': lf(bashScript),
    'fish.fish': lf(fishScript),
    'pwsh.ps1': pwshScript.replace(/\r?\n/g, '\r\n'),
    'zsh/.zshrc': lf(zshrcScript),
  };
  for (const name of ['.zshenv', '.zprofile', '.zlogin']) files[`zsh/${name}`] = lf(zshForward).replaceAll('__DB_FILE__', name);
  return files;
}

const written = new Set<string>();

/** Creates `dir` (mode 0o700) and throws unless it is a real directory, not a link, owned by the current user. */
function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`Shell integration folder is not a plain directory: ${dir}`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`Shell integration folder is owned by another user: ${dir}`);
}

/** Writes the scripts to `dir` once per process (rewriting any that differ). */
export function ensureIntegrationFiles(dir: string): void {
  if (written.has(dir)) return;
  privateDir(dir);
  for (const [rel, content] of Object.entries(integrationFiles())) {
    const path = join(dir, rel);
    let current: string | null = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {}
    if (current === content) continue;
    if (rel.includes('/')) privateDir(join(path, '..'));
    writeFileSync(path, content, { mode: 0o600 });
  }
  written.add(dir);
}

/** The integrated shell an argv runs: the profile's shell id, or for `auto` the executable's name. */
export function integratedShell(id: ShellId | 'custom', argv: string[]): IntegratedShell | null {
  let kind: string = id;
  if (id === 'auto') {
    const exe = argv[0] ?? '';
    kind = exe
      .slice(Math.max(exe.lastIndexOf('/'), exe.lastIndexOf('\\')) + 1)
      .toLowerCase()
      .replace(/\.exe$/, '');
  }
  switch (kind) {
    case 'bash':
    case 'git-bash':
    case 'zsh':
    case 'fish':
    case 'powershell':
    case 'pwsh':
    case 'cmd':
      return kind;
    default:
      return null;
  }
}

/** Forward slashes: Windows shells and Git Bash accept them, and they need no escaping. */
const slashes = (p: string) => p.replace(/\\/g, '/');

const LOGIN_FLAGS = new Set(['-l', '--login', '-i']);

/**
 * Argv and env that load the integration script for `shell` (files already in `dir`).
 * `env` is the env the session would get otherwise; the result merges into it.
 * `prompt: 'kedalion'` makes the script replace the shell's prompt with Kedalion's, drawn from `style`
 * (`KEDALION_PROMPT` spec and `KEDALION_PROMPT_SYMBOL`; cmd gets a `PROMPT` built here).
 */
export function withIntegration(
  shell: IntegratedShell,
  argv: string[],
  dir: string,
  env: Record<string, string | undefined>,
  opts: { prompt?: TerminalPrompt; style?: PromptStyle } = {},
): { argv: string[]; env: Record<string, string> } {
  const style = opts.prompt === 'kedalion' ? (opts.style ?? DEFAULT_PROMPT_STYLE) : null;
  const r = integrationArgs(shell, argv, dir, env, style);
  if (style && shell !== 'cmd') {
    // Never empty: an empty variable reads as unset, which would keep the shell's prompt.
    r.env.KEDALION_PROMPT = promptSpec(style) || '-';
    r.env.KEDALION_PROMPT_SYMBOL = style.symbol;
    // Custom segment bodies: the bash and zsh scripts define prompt_<name> from these.
    for (const c of style.customs ?? []) if (style.segments.some((s) => s.kind === 'custom' && s.name === c.name)) r.env[`KEDALION_PROMPT_FN_${c.name}`] = c.script;
  }
  return r;
}

/** `terminal.prompt`: keep the shell's own prompt, or use Kedalion's. */
export type TerminalPrompt = 'shell' | 'kedalion';

function integrationArgs(
  shell: IntegratedShell,
  argv: string[],
  dir: string,
  env: Record<string, string | undefined>,
  style: PromptStyle | null,
): { argv: string[]; env: Record<string, string> } {
  const [exe = '', ...args] = argv;
  switch (shell) {
    case 'bash':
    case 'git-bash':
      // --rcfile is ignored by login shells; the script sources the login files itself.
      return { argv: [exe, '--rcfile', slashes(join(dir, 'bash.sh')), ...args.filter((a) => !LOGIN_FLAGS.has(a)), '-i'], env: {} };
    case 'zsh':
      return { argv, env: { ZDOTDIR: join(dir, 'zsh'), KEDALION_USER_ZDOTDIR: env.ZDOTDIR ?? '' } };
    case 'fish':
      return { argv: [...argv, '--init-command', `source '${join(dir, 'fish.fish').replace(/[\\']/g, '\\$&')}'`], env: {} };
    case 'powershell':
    case 'pwsh': {
      // A script block from the file text: dot-sourcing the file itself would fail under the Restricted policy.
      const path = join(dir, 'pwsh.ps1').replace(/'/g, "''");
      return { argv: [...argv, '-NoExit', '-Command', `. ([scriptblock]::Create([IO.File]::ReadAllText('${path}')))`], env: {} };
    }
    case 'cmd': {
      const user = style ? cmdPrompt(style) : env.PROMPT || '$P$G';
      return { argv, env: { PROMPT: `$E]133;D$E\\$E]7;file://localhost/$P$E\\$E]133;A$E\\${user}$E]133;B$E\\` } };
    }
  }
}

/**
 * A cmd `PROMPT` for the style: cmd knows only the path ($P) and line breaks ($_), so the other segments are left out;
 * the symbol keeps its success color (cmd has no exit status at the prompt).
 */
export function cmdPrompt(style: PromptStyle): string {
  const spec = promptSpec(style).split(' ');
  let out = '';
  let line = false;
  for (const token of spec) {
    const [kind, sgr] = token.split(':');
    let text: string | null = null;
    if (kind === 'newline') {
      out += '$_';
      line = false;
      continue;
    }
    if (kind === 'cwd' || kind === 'folder') text = '$P';
    else if (kind === 'symbol') text = style.symbol.replace(/\$/g, '$$$$');
    if (text === null) continue;
    out += `${line ? ' ' : ''}$E[${sgr}m${text}$E[0m`;
    line = true;
  }
  return `${out} `;
}
