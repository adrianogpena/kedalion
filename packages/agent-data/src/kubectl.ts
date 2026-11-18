import { jsonPick, grepLines } from './format.ts';
import { failResult, type McpTool, textResult, type ToolResult } from './mcp.ts';

export interface KubeRun {
  code: number;
  stdout: string;
  stderr: string;
}

export interface KubectlDeps {
  /** Runs `kubectl <args>` without a shell; rejects when kubectl is missing. */
  run(args: string[], timeoutMs: number): Promise<KubeRun>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 2000;
const DNS = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;
const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/;
const KIND = /^[a-z][a-z0-9.]*(\/[a-z0-9.]+)?$/;
const SELECTOR = /^[A-Za-z0-9_.,=!()/ -]+$/;
const SECRET_KINDS = /^(secrets?|secret\.v1)$/i;

/** `kubectl` through Bun.spawn, no shell; killed on timeout. */
export function spawnKubectl(args: string[], timeoutMs: number): Promise<KubeRun> {
  if (!Bun.which('kubectl')) return Promise.reject(new Error('kubectl is not installed or not on PATH.'));
  const proc = Bun.spawn(['kubectl', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', windowsHide: true });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    .then(([stdout, stderr, code]) => ({ code, stdout, stderr }))
    .finally(() => clearTimeout(timer));
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), min), max) : fallback);

class ArgError extends Error {}

function need(value: unknown, name: string, pattern: RegExp): string {
  const text = str(value);
  if (!text) throw new ArgError(`Missing argument: ${name}. Ask the user which one to use; do not choose it.`);
  if (!pattern.test(text)) throw new ArgError(`Invalid ${name}: ${text}`);
  return text;
}

const CONTEXT_PROP = { type: 'string', description: 'kubectl context name (see kube_contexts). Use the one the user or the session context named; otherwise ask the user.' } as const;
const NAMESPACE_PROP = { type: 'string', description: 'Namespace. Use the one the user or the session context named; otherwise ask the user.' } as const;

const commonProps = { context: CONTEXT_PROP, namespace: NAMESPACE_PROP } as const;

/** Read-only kubectl tools for sessions: contexts, get, decoded secrets, logs. Nothing here writes to a cluster. */
export function kubectlTools(deps: KubectlDeps): McpTool[] {
  const base = (args: Record<string, unknown>) => ['--context', need(args.context, 'context', CONTEXT), '-n', need(args.namespace, 'namespace', DNS)];

  async function kubectl(argv: string[], timeoutMs: number): Promise<string> {
    const r = await deps.run(argv, timeoutMs);
    if (r.code !== 0) throw new ArgError(r.stderr.trim() || `kubectl exited with ${r.code}`);
    return r.stdout;
  }

  const guard = (fn: (args: Record<string, unknown>) => Promise<ToolResult>) => async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof ArgError) return failResult(e.message);
      throw e;
    }
  };

  return [
    {
      name: 'kube_contexts',
      description: 'List the kubectl contexts (names, current marked with *). Pass a name as `context` to the other kube_* tools.',
      inputSchema: { type: 'object', properties: {} },
      run: guard(async () => {
        const [names, current] = await Promise.all([kubectl(['config', 'get-contexts', '-o', 'name'], DEFAULT_TIMEOUT_MS), kubectl(['config', 'current-context'], DEFAULT_TIMEOUT_MS).catch(() => '')]);
        const cur = current.trim();
        return textResult(names.split('\n').map((n) => n.trim()).filter(Boolean).map((n) => (n === cur ? `* ${n}` : `  ${n}`)).join('\n') || 'No contexts.');
      }),
    },
    {
      name: 'kube_get',
      description: 'Read cluster objects (kubectl get). Without `name` lists the kind, one row per object (name, status columns); with `name` returns the object as JSON, trimmed by `select` (JSON path like $.status.phase or $.spec.containers[0].image). Secrets are not served here: use kube_secret.',
      inputSchema: {
        type: 'object',
        properties: {
          ...commonProps,
          kind: { type: 'string', description: 'Resource kind, e.g. pods, deployments, configmaps, ingress, services.' },
          name: { type: 'string', description: 'One object name; omit to list.' },
          selector: { type: 'string', description: 'Label selector for a list, e.g. app=foo.' },
          select: { type: 'string', description: 'JSON path into the object (name given only).' },
          grep: { type: 'string', description: 'Keep only output lines containing this text (with one line of context).' },
        },
        required: ['kind'],
      },
      run: guard(async (args) => {
        const kind = need(args.kind, 'kind', KIND);
        if (SECRET_KINDS.test(kind)) return failResult('Use kube_secret for secrets.');
        const argv = [...base(args), 'get', kind];
        const name = str(args.name);
        if (name) {
          argv.push(need(name, 'name', DNS), '-o', 'json');
          const text = await kubectl(argv, DEFAULT_TIMEOUT_MS);
          let out = text;
          try {
            const obj = JSON.parse(text) as { metadata?: { managedFields?: unknown; annotations?: Record<string, unknown> } };
            if (obj.metadata) {
              delete obj.metadata.managedFields;
              if (obj.metadata.annotations) delete obj.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
            }
            const picked = str(args.select) ? jsonPick(obj, str(args.select)) : obj;
            out = picked === undefined ? `Nothing at ${str(args.select)}.` : typeof picked === 'string' ? picked : JSON.stringify(picked, null, 2);
          } catch {}
          return textResult(args.grep ? grepLines(out, str(args.grep)) || 'No matching lines.' : out, 'Use select or grep to narrow.');
        }
        const selector = str(args.selector);
        if (selector) {
          if (!SELECTOR.test(selector)) return failResult(`Invalid selector: ${selector}`);
          argv.push('-l', selector);
        }
        const text = await kubectl([...argv, '-o', 'wide'], DEFAULT_TIMEOUT_MS);
        return textResult(args.grep ? grepLines(text, str(args.grep)) || 'No matching lines.' : text.trim() || 'No resources found.', 'Use selector or grep to narrow.');
      }),
    },
    {
      name: 'kube_secret',
      description: 'Read a Secret and return its keys base64-decoded (like k9s Secret Decoder), as `key=value` lines. Use it to get credentials for tests; do not repeat the values in summaries or commit them. Binary values show as `<binary N bytes>`.',
      inputSchema: {
        type: 'object',
        properties: { ...commonProps, name: { type: 'string', description: 'Secret name.' }, keys: { type: 'array', items: { type: 'string' }, description: 'Only these keys (default: all).' } },
        required: ['name'],
      },
      run: guard(async (args) => {
        const name = need(args.name, 'name', DNS);
        const text = await kubectl([...base(args), 'get', 'secret', name, '-o', 'json'], DEFAULT_TIMEOUT_MS);
        const data = (JSON.parse(text) as { data?: Record<string, string> }).data ?? {};
        const want = Array.isArray(args.keys) ? new Set(args.keys.map(String)) : undefined;
        const lines: string[] = [];
        for (const [key, b64] of Object.entries(data)) {
          if (want && !want.has(key)) continue;
          const bytes = Buffer.from(b64, 'base64');
          const value = bytes.toString('utf8');
          lines.push(`${key}=${value.includes('�') ? `<binary ${bytes.length} bytes>` : value}`);
        }
        if (want) for (const k of want) if (!(k in data)) lines.push(`${k}: missing (keys: ${Object.keys(data).join(', ') || 'none'})`);
        return textResult(lines.join('\n') || 'The secret has no data.', 'Pass keys to fetch fewer values.');
      }),
    },
    {
      name: 'kube_logs',
      description: `Last lines of a pod's logs (all containers unless \`container\` is given). \`tail\` default ${DEFAULT_LOG_LINES}, max ${MAX_LOG_LINES}. Use grep to find a message.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...commonProps,
          pod: { type: 'string', description: 'Pod name, or `deployment/<name>`.' },
          container: { type: 'string', description: 'Container name.' },
          tail: { type: 'integer', description: `Lines from the end (default ${DEFAULT_LOG_LINES}).` },
          previous: { type: 'boolean', description: 'Logs of the previous (crashed) container.' },
          grep: { type: 'string', description: 'Keep only lines containing this text (with one line of context).' },
        },
        required: ['pod'],
      },
      run: guard(async (args) => {
        const pod = need(args.pod, 'pod', /^(deployment\/|statefulset\/|job\/)?[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/);
        const argv = [...base(args), 'logs', pod, `--tail=${num(args.tail, DEFAULT_LOG_LINES, 1, MAX_LOG_LINES)}`];
        if (str(args.container)) argv.push('-c', need(args.container, 'container', DNS));
        else argv.push('--all-containers=true');
        if (args.previous === true) argv.push('--previous');
        const text = await kubectl(argv, 30_000);
        return textResult(args.grep ? grepLines(text, str(args.grep)) || 'No matching lines.' : text || 'No log lines.', 'Lower tail or use grep.');
      }),
    },
  ];
}
