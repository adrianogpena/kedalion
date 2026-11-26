import { runCli } from '../../cli';
import { defineSource } from '../../server';

export const gitEmailSource = defineSource<Record<string, never>>({
  id: 'git-email',
  fields: [],
  async fetch(_config, { signal }) {
    try {
      const r = await runCli(['git', 'config', '--get', 'user.email'], { timeoutMs: 5000, signal });
      const email = r.code === 0 ? r.stdout.trim() : '';
      return { options: email ? [{ value: email }] : [] };
    } catch {
      return { options: [] };
    }
  },
});
