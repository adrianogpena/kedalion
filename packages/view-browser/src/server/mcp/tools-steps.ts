import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { num, str } from './page-util.ts';
import { diffRuns, renderStepLine, renderSteps, runSteps, startRun, stepLogFor } from './steps.ts';
import { failResult, type McpTool, textResult, type ToolSchema } from './types.ts';

const schema = (properties: ToolSchema['properties'], required: string[] = []): ToolSchema => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

export const stepTools: McpTool[] = [
  {
    name: 'browser_steps',
    description: 'The recorded log of browser tool calls of this session (tool, args, ok/error, time, requests started, console errors), newest last.',
    inputSchema: schema({
      limit: { type: 'integer', description: 'Newest N steps, default 30.' },
      clear: { type: 'boolean', description: 'Clear the log (and the named runs) after listing.' },
    }),
    async run(a, ctx) {
      const log = stepLogFor(ctx.service);
      const steps = log.steps.slice(-Math.max(num(a, 'limit') ?? 30, 1));
      const text = steps.length ? steps.map(renderStepLine).join('\n') : 'No steps recorded.';
      if (a.clear === true) {
        log.steps = [];
        log.marks = [];
      }
      return textResult(text, 'Pass a smaller limit.');
    },
  },
  {
    name: 'browser_steps_mark',
    description: 'Start a named run: the steps from now until the next browser_steps_mark belong to it. Compare two runs with browser_steps_diff.',
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    async run(a, ctx) {
      startRun(stepLogFor(ctx.service), a.name as string);
      return textResult(`Run ${a.name} started.`);
    },
  },
  {
    name: 'browser_steps_export',
    description: 'Save the step log as json or md in the Downloads folder (or to path inside Downloads, .json or .md, never overwriting); returns the path.',
    inputSchema: schema({
      format: { type: 'string', enum: ['json', 'md'] },
      path: { type: 'string', description: 'Target file inside Downloads (.json or .md, must not exist); default a new file there.' },
      run: { type: 'string', description: 'Only the steps of this named run.' },
    }),
    async run(a, ctx) {
      const log = stepLogFor(ctx.service);
      const format = str(a, 'format') === 'md' ? 'md' : 'json';
      const run = str(a, 'run');
      const steps = run ? runSteps(log, run) : log.steps;
      if (!steps) return failResult(`No run named ${run}.`);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const downloads = resolve(homedir(), 'Downloads');
      const path = resolve(downloads, str(a, 'path') ?? `kedalion-steps-${stamp}.${format}`);
      if (!path.startsWith(downloads + sep)) return failResult('path must be inside the Downloads folder.');
      if (!/\.(json|md)$/i.test(path)) return failResult('path must end in .json or .md.');
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, renderSteps(steps, format), { flag: 'wx' });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') return failResult(`${path} already exists.`);
        throw e;
      }
      return textResult(`Saved ${steps.length} steps to ${path}`);
    },
  },
  {
    name: 'browser_steps_diff',
    description: 'Compare two named runs (browser_steps_mark) step by step: differing results, console errors and requests.',
    inputSchema: schema({ a: { type: 'string', description: 'Name of the first run.' }, b: { type: 'string', description: 'Name of the second run.' } }, ['a', 'b']),
    async run(a, ctx) {
      const log = stepLogFor(ctx.service);
      const x = runSteps(log, a.a as string);
      const y = runSteps(log, a.b as string);
      if (!x) return failResult(`No run named ${a.a}.`);
      if (!y) return failResult(`No run named ${a.b}.`);
      return textResult(diffRuns(x, y), 'Compare shorter runs.');
    },
  },
];
