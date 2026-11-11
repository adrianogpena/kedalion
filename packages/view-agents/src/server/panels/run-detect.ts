import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Something the Run panel can start in a project folder. */
export interface RunTarget {
  /** Stable id within the project (`script:dev`, `go`, `cargo`, ...). */
  id: string;
  /** Label shown in the list (`dev`, `go run .`). */
  label: string;
  /** Where it was found (`package.json`, `go.mod`, ...). */
  source: string;
  /** The program and its arguments; never sent by the client. */
  cmd: string[];
}
const SAFE_NAME = /^[\w.:@/-]+$/;

/** Package manager of a Node project by its lockfile (npm without one). */
export function managerOf(files: string[]): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (files.includes('bun.lock') || files.includes('bun.lockb')) return 'bun';
  if (files.includes('pnpm-lock.yaml')) return 'pnpm';
  if (files.includes('yarn.lock')) return 'yarn';
  return 'npm';
}

/** Runnable targets in the top folder of a project: package.json scripts and the usual build files of other stacks. */
export async function detectTargets(dir: string): Promise<RunTarget[]> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: RunTarget[] = [];
  const has = (name: string) => files.includes(name);

  if (has('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
      const manager = managerOf(files);
      for (const name of Object.keys(pkg.scripts ?? {})) {
        if (typeof pkg.scripts![name] !== 'string' || !SAFE_NAME.test(name) || name.startsWith('-')) continue;
        out.push({ id: `script:${name}`, label: name, source: 'package.json', cmd: [manager, 'run', name] });
      }
    } catch {
      // unreadable package.json: no scripts
    }
  }
  if (has('go.mod')) out.push({ id: 'go', label: 'go run .', source: 'go.mod', cmd: ['go', 'run', '.'] });
  if (has('Cargo.toml')) out.push({ id: 'cargo', label: 'cargo run', source: 'Cargo.toml', cmd: ['cargo', 'run'] });
  for (const f of files.filter((f) => f.toLowerCase().endsWith('.csproj') && SAFE_NAME.test(f) && !f.startsWith('-')).sort()) {
    out.push({ id: `dotnet:${f}`, label: `dotnet run (${f})`, source: f, cmd: ['dotnet', 'run', '--project', f] });
  }
  if (has('manage.py')) out.push({ id: 'django', label: 'manage.py runserver', source: 'manage.py', cmd: ['python', 'manage.py', 'runserver'] });
  if (has('pom.xml')) out.push({ id: 'maven', label: 'mvn spring-boot:run', source: 'pom.xml', cmd: ['mvn', 'spring-boot:run'] });
  const gradle = ['build.gradle', 'build.gradle.kts'].find(has);
  if (gradle) out.push({ id: 'gradle', label: 'gradle bootRun', source: gradle, cmd: ['gradle', 'bootRun'] });
  const compose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].find(has);
  if (compose) out.push({ id: 'compose', label: 'docker compose up', source: compose, cmd: ['docker', 'compose', '-f', compose, 'up'] });
  return out;
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d+[^\s'"<>)\]]*/;

/** The first local URL in program output (ANSI codes ignored); 0.0.0.0 is shown as localhost. */
export function findUrl(text: string): string | undefined {
  const m = URL_RE.exec(text.replace(ANSI, ''));
  return m ? m[0].replace('0.0.0.0', 'localhost').replace(/[.,;:]+$/, '') : undefined;
}
