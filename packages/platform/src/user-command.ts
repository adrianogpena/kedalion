export type CommandVars = Record<string, string | string[]>;

const MARKER = /\{\{(\w+)\}\}/g;
const WHOLE = /^\{\{(\w+)\}\}$/;

/**
 * Expands `{{name}}` markers in an argv template. An argument that is exactly one marker with a list
 * value becomes several arguments (none when the list is empty); inside longer text a list joins with
 * spaces. Replacement is one pass, so values containing markers are not expanded again; unknown
 * markers stay as written.
 */
export function buildUserCommand(template: string[], vars: CommandVars): string[] {
  const out: string[] = [];
  for (const arg of template) {
    const whole = WHOLE.exec(arg);
    const value = whole ? vars[whole[1]!] : undefined;
    if (Array.isArray(value)) {
      out.push(...value);
      continue;
    }
    out.push(
      arg.replace(MARKER, (m, name: string) => {
        const v = vars[name];
        return v === undefined ? m : Array.isArray(v) ? v.join(' ') : v;
      }),
    );
  }
  return out;
}
