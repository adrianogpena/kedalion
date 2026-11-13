// Tool-call areas, safe labels and short model names.
// Adapted from lot-map `hooks/classify.ts` (MIT, (c) 2026 Aleksei Volodin, https://github.com/alexeyw/lot-map).
import type { AgentTraceArea } from '../protocol.ts';

/** A path with Windows separators written as `/`, so that one rule reads paths from every system. */
const slashes = (path: string): string => path.replace(/\\/g, '/');

const HOST = /^(?:[\p{L}\p{N}.-]+|\[[0-9a-f:.]+\])(?::\d+)?$/iu;

/**
 * Only the host: a login, a password, a path or a query never reach the result. A password may hold `/`, `?` or `#`
 * unencoded, so `user:pa/ss@host` reads as `host`, and an address that can be read both ways gives its scheme alone.
 */
export function hostOf(url: string): string {
  const [, scheme = '', rest = ''] = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(.*)$/is.exec(url) ?? [];
  const end = rest.search(/[/?#]/);
  const first = end < 0 ? rest : rest.slice(0, end);
  const beyond = end < 0 ? '' : rest.slice(end);
  let host = first.split('@').pop() ?? '';
  if (!first.startsWith('[') && !first.includes('@') && first.includes(':') && beyond.includes('@')) {
    host = /:\d+$/.test(first) ? '' : (rest.slice(rest.lastIndexOf('@') + 1).split(/[/?#]/)[0] ?? '');
  }
  return HOST.test(host) ? host.slice(0, 60) : scheme;
}

/** A URL without its login, password, query or fragment: `https://u:p@host/a/b?token=x` is `https://host/a/b?…`. */
export function safeUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(url.trim());
  if (!m) return url;
  const host = hostOf(url);
  if (!host || host === m[1]) return `${m[1]}://…`;
  const after = m[2]!.slice(m[2]!.lastIndexOf(host) + host.length);
  const q = after.search(/[?#]/);
  const path = q < 0 ? after : after.slice(0, q);
  return `${m[1]}://${host}${path.startsWith('/') ? path : ''}${q < 0 ? '' : '?…'}`;
}

/** `scheme://login:password@` inside any text loses the login and password. */
export const redactCredentials = (text: string): string => text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1***@');

const BIDI_AND_C1 = /[\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** A one-line label as it may be shown: no control characters (a terminal would act on them) and no direction marks. */
export function clean(label: string): string {
  return label.replace(/[\u0000-\u001f]/g, ' ').replace(BIDI_AND_C1, '').replace(/ {2,}/g, ' ').trim();
}

/** Multi-line text as it may be shown: keeps newlines and tabs, drops other control characters and direction marks. */
export function cleanText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(BIDI_AND_C1, '');
}

/** Claude Code's memory folder in any profile dir (`.claude`, `.claude-personal`, …). */
export const isMemoryPath = (path: string): boolean => /\/\.claude[^/]*\/projects\/[^/]+\/memory\//i.test(slashes(path));

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Commands that work on files and nothing else. echo, cd and the like say nothing either way. */
const FILE_WORDS = new Set(['cat', 'head', 'tail', 'sed', 'grep', 'rg', 'find', 'ls', 'wc', 'cp', 'mv', 'mkdir', 'touch', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'tr', 'awk', 'tee', 'stat', 'file', 'du', 'tree', 'ln', 'basename', 'dirname', 'realpath', 'jq', 'rm', 'rmdir']);
const NEUTRAL_WORDS = new Set(['echo', 'printf', 'cd', 'export', 'true', 'set', 'pwd', 'sleep', 'which', 'test', '[']);
const NET_WORDS = new Set(['curl', 'wget', 'gh', 'ssh', 'scp', 'sftp', 'ftp', 'rsync', 'nc', 'ncat', 'telnet', 'ping', 'dig', 'nslookup']);
/** Commands that reach the network only with some of their subcommands. */
const NET_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  git: new Set(['push', 'pull', 'fetch', 'clone', 'ls-remote']),
  npm: new Set(['install', 'i', 'ci', 'add', 'update', 'publish', 'view', 'audit']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'publish', 'dlx']),
  yarn: new Set(['install', 'add', 'upgrade', 'publish', 'dlx']),
  bun: new Set(['install', 'add', 'update', 'publish']),
  pip: new Set(['install', 'download']),
  pip3: new Set(['install', 'download']),
  pipx: new Set(['install', 'upgrade', 'upgrade-all', 'run']),
  uv: new Set(['add', 'sync', 'lock', 'publish', 'tool install']),
  poetry: new Set(['install', 'add', 'update', 'lock', 'publish']),
  docker: new Set(['pull', 'push', 'login']),
  'docker compose': new Set(['pull', 'push']),
  brew: new Set(['install', 'update', 'upgrade', 'fetch']),
  cargo: new Set(['install', 'fetch', 'publish', 'update']),
  go: new Set(['get', 'install', 'mod download']),
  apt: new Set(['install', 'update', 'upgrade', 'full-upgrade', 'dist-upgrade']),
  'apt-get': new Set(['install', 'update', 'upgrade', 'dist-upgrade']),
  winget: new Set(['install', 'upgrade', 'search']),
  scoop: new Set(['install', 'update']),
};
/** Programs that Python runs as a module: `python -m pip install` is `pip install`. */
const PY_MODULES = new Set(['pip', 'uv', 'pipx', 'poetry']);

/** Commands that run another command; `takes` lists flags with a word after them, `skip` words of their own, `asks` flags that run nothing. */
const WRAPPERS: Record<string, { takes?: readonly string[]; skip?: number; asks?: readonly string[] }> = {
  sudo: { takes: ['-u', '-g', '-p', '-h', '-C', '-D', '-R', '-T', '-U', '-r', '-t'] },
  doas: { takes: ['-u', '-C'] },
  env: { takes: ['-u', '-C'] },
  time: {},
  timeout: { takes: ['-s', '-k'], skip: 1 },
  nohup: {},
  nice: { takes: ['-n'] },
  ionice: { takes: ['-c', '-n'] },
  stdbuf: { takes: ['-i', '-o', '-e'] },
  caffeinate: { takes: ['-t', '-w'] },
  command: { asks: ['-v', '-V'] },
  exec: { takes: ['-a'] },
  xargs: { takes: ['-n', '-I', '-P', '-L', '-d', '-E', '-s', '-a', '-J', '-R'] },
  rtk: { asks: ['gain', 'discover', 'session', 'hook', 'recall'] },
  // `rtk bypass <cmd>` / `rtk proxy <cmd>`: the command after them is the one run.
  bypass: {},
  proxy: {},
};
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const GIT_TAKES = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);
const DOCKER_TAKES = new Set(['-c', '--context', '-H', '--host', '--config', '-l', '--log-level', '-f', '--file', '-p', '--project-name', '--profile', '--env-file', '--project-directory']);

const pastFlags = (words: string[], takes: { has(flag: string): boolean }): string[] => {
  let i = 0;
  while (i < words.length && (words[i] ?? '').startsWith('-')) i += takes.has(words[i] ?? '') ? 2 : 1;
  return words.slice(i);
};

const PS_FILE_WORDS = new Set(['get-content', 'gc', 'type', 'set-content', 'add-content', 'out-file', 'get-childitem', 'gci', 'dir', 'get-item', 'gi', 'select-string', 'sls', 'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'rni', 'ren', 'new-item', 'ni', 'md', 'test-path', 'resolve-path', 'get-filehash', 'remove-item', 'ri', 'del']);
const PS_NEUTRAL_WORDS = new Set(['write-host', 'write-output', 'set-location', 'sl', 'get-location', 'gl', 'start-sleep', 'select-object', 'select', 'where-object', 'where', '?', 'foreach-object', 'foreach', '%', 'sort-object', 'measure-object', 'measure', 'format-table', 'ft', 'format-list', 'fl', 'out-string', 'out-null']);
const PS_NET_WORDS = new Set(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'test-connection', 'test-netconnection', 'resolve-dnsname', 'start-bitstransfer']);

/** The words of each command in a shell line, leading assignments taken off. `deep` also cuts at `$(…)`, backticks and brackets. */
function segments(command: string, deep = false): string[][] {
  return command
    .split(deep ? /&&|\|\||;|\||\n|\$\(|`|\(|\)/ : /&&|\|\||;|\||\n/)
    .map((part) => part.match(/(?:[^\s"']|"[^"]*"?|'[^']*'?)+/g) ?? [])
    .map((words) => {
      let i = 0;
      while (i < words.length && ASSIGNMENT.test(words[i] ?? '')) i++;
      return words.slice(i);
    })
    .filter((words) => words.length > 0);
}

/** A command's own name: no quotes, no folder; a Windows program loses `.exe`/`.cmd`/`.bat` and its capitals. */
const base = (word = ''): string => {
  const name = slashes(word.replace(/["']/g, '')).split('/').pop() ?? word;
  return /\.(?:exe|cmd|bat)$/i.test(name) ? name.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase() : name;
};

/** The area of a shell line. `powershell` adds PowerShell's command names and reads names in lower case. */
export function shellArea(command: string, powershell = false): AgentTraceArea {
  const name = (word?: string): string => (powershell ? base(word).toLowerCase() : base(word));
  const own = (words: string[]): string[] => {
    if (!powershell) return words;
    let i = 0;
    if (/^\$[\w:]+$/.test(words[0] ?? '') && words[1] === '=') i = 2;
    if (words[i] === '&' || words[i] === '.') i++;
    return words.slice(i);
  };
  const unwrapped = (words: string[]): string[] => {
    let rest = words;
    for (let depth = 0; depth < 6; depth++) {
      const wrapper = WRAPPERS[name(rest[0])];
      if (wrapper === undefined) break;
      if (wrapper.asks?.some((flag) => rest[1] === flag) === true) break;
      rest = pastFlags(rest.slice(1), new Set(wrapper.takes ?? []));
      let i = 0;
      while (i < rest.length && ASSIGNMENT.test(rest[i] ?? '')) i++;
      rest = rest.slice(i + (wrapper.skip ?? 0));
    }
    return rest;
  };
  const commands = (words: string[]): string[][] => {
    const outer = unwrapped(words);
    const all = [outer];
    if (name(outer[0]) === 'find') {
      outer.forEach((word, i) => {
        if (!/^-(?:exec|execdir|ok|okdir)$/.test(word)) return;
        const tail = outer.slice(i + 1);
        const end = tail.findIndex((w) => w === ';' || w === '\\;' || w === '\\' || w === '+');
        all.push(unwrapped(end < 0 ? tail : tail.slice(0, end)));
      });
    }
    return all.filter((c) => c.length > 0);
  };
  const isNet = (words: string[]): boolean => {
    let head = name(words[0]);
    let rest = words.slice(1);
    if (NET_WORDS.has(head) || (powershell && PS_NET_WORDS.has(head))) return true;
    if (/^(?:python[\d.]*|py)$/.test(head) && rest[0] === '-m' && PY_MODULES.has(rest[1] ?? '')) [head, rest] = [rest[1] ?? '', rest.slice(2)];
    if (head === 'uv' && rest[0] === 'pip') [head, rest] = ['pip', rest.slice(1)];
    if (head === 'git') rest = pastFlags(rest, GIT_TAKES);
    if (head === 'docker') {
      rest = pastFlags(rest, DOCKER_TAKES);
      if (rest[0] === 'compose') [head, rest] = ['docker compose', pastFlags(rest.slice(1), DOCKER_TAKES)];
    }
    if (head === 'npx' || head === 'bunx') return rest.some((w) => w === '-y' || w === '--yes');
    const subs = NET_SUBCOMMANDS[head];
    return subs !== undefined && (subs.has(rest[0] ?? '') || subs.has(`${rest[0] ?? ''} ${rest[1] ?? ''}`));
  };
  const lines = segments(command).map(own).filter((words) => words.length > 0);
  if (segments(command, true).map(own).flatMap(commands).some(isNet)) return 'web';
  const isNeutral = (head: string): boolean => NEUTRAL_WORDS.has(head) || (powershell && PS_NEUTRAL_WORDS.has(head));
  const isFile = (head: string): boolean => FILE_WORDS.has(head) || (powershell && PS_FILE_WORDS.has(head));
  const real = lines.flatMap(commands).filter((words) => !isNeutral(name(words[0])));
  if (real.length > 0 && real.every((words) => isFile(name(words[0])))) return isMemoryPath(command) ? 'memory' : 'files';
  return 'shell';
}

/** MCP servers whose tools drive a browser. */
const BROWSER_SERVERS = /^(?:kedalion-browser|Claude_Browser|claude-in-chrome|playwright|puppeteer|chrome-devtools|browser.*)$/i;

/** The area of a tool call. */
export function areaOf(tool: string, input: Record<string, unknown>): AgentTraceArea {
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return isMemoryPath(str(input.file_path) || str(input.notebook_path)) ? 'memory' : 'files';
    case 'Grep':
    case 'Glob':
    case 'LS':
      return isMemoryPath(str(input.path)) ? 'memory' : 'files';
    case 'Bash':
      return shellArea(str(input.command));
    case 'PowerShell':
      return shellArea(str(input.command), true);
    case 'BashOutput':
    case 'KillShell':
    case 'Monitor':
      return 'shell';
    case 'WebFetch':
    case 'WebSearch':
    case 'Artifact':
      return 'web';
    case 'Agent':
    case 'Task':
    case 'Workflow':
    case 'SendMessage':
    case 'TaskStop':
    case 'TaskOutput':
      return 'agents';
    case 'Skill':
    case 'ToolSearch':
      return 'skills';
    case 'AskUserQuestion':
    case 'SendUserFile':
    case 'ExitPlanMode':
      return 'you';
    case 'TodoWrite':
    case 'EnterPlanMode':
      return 'model';
  }
  const mcp = /^mcp__([^_].*?)__(.+)$/.exec(tool);
  if (mcp === null) return 'shell';
  const server = mcp[1] ?? '';
  if (/memory/i.test(server)) return 'memory';
  if (BROWSER_SERVERS.test(server)) return 'browser';
  if (server === 'terminal') return 'shell';
  if (server === 'visualize' || server.startsWith('ccd_')) return 'you';
  return 'web';
}
