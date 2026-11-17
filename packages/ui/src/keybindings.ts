/** Scope of the commands that work on every screen. */
export const GLOBAL = 'global';

export interface CommandDef {
  /** Unique, `[\w.:-]{1,80}`, e.g. 'nav.explorer', 'explorer.search', 'explorer.tab.new'. */
  id: string;
  /** GLOBAL or a view id (the app's screen id). */
  scope: string;
  /** Translated text; build defs in functions called at render, like grid `defs()`. */
  label: string;
  /** Default chords in canonical form, e.g. ['Ctrl+Shift+F']. */
  keys: string[];
  /** Fires while typing; default: true when the chord has Ctrl, Alt or Meta, else false. */
  inInput?: boolean;
  /** Fires while a Modal or the palette is open; default false. */
  inModal?: boolean;
  /** Only bound in the native window (browsers keep Ctrl+T/W/Tab). */
  desktopOnly?: boolean;
  /** Fires only while focus is inside `[data-key-scope="<focus>"]` (see `KEY_SCOPE_ATTR`); default: anywhere. */
  focus?: string;
}

/** User overrides by command id; [] = unbound. */
export type Keymap = Record<string, string[]>;

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

const NAMED = ['Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

const ID = /^[\w.:-]{1,80}$/;
const MAX_IDS = 300;
const MAX_CHORDS = 4;
/** Most chords in one binding. */
export const MAX_STEPS = 3;

function chord(mods: Set<Modifier>, key: string): string {
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

function keyOf(e: KeyLike): string | null {
  let m = /^Key([A-Z])$/.exec(e.code);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (m) return m[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key;
  if (e.code === 'Space' || e.key === ' ') return 'Space';
  if (NAMED.includes(e.key)) return e.key;
  if (e.key === 'Esc') return 'Escape';
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

/** The canonical chord of a key event; null for a modifier alone or an unknown key. */
export function chordOf(e: KeyLike): string | null {
  const key = keyOf(e);
  if (!key) return null;
  const mods = new Set<Modifier>();
  if (e.ctrlKey) mods.add('Ctrl');
  if (e.altKey) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  if (e.metaKey) mods.add('Meta');
  return chord(mods, key);
}

const MOD_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl', control: 'Ctrl', ctl: 'Ctrl',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  meta: 'Meta', cmd: 'Meta', command: 'Meta',
};

const KEY_ALIASES: Record<string, string> = {
  minus: '-', hyphen: '-', esc: 'Escape', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', plus: '+',
  ...Object.fromEntries(NAMED.map((k) => [k.toLowerCase(), k])),
};

function normalizeKey(text: string): string | null {
  const lower = text.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  const f = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  if (f) return `F${f[1]}`;
  if (text.length === 1 && text !== ' ') return text.toUpperCase();
  return null;
}

/** Steps of a sequence ("Ctrl+K Ctrl+C"): whitespace splits steps unless it touches a '+'. */
const STEP_SPLIT = /(?<!\+)\s+(?!\+)/;

/** The chords of a binding in order; a single chord is a one-step sequence. */
export function stepsOf(sequence: string): string[] {
  return sequence.split(' ');
}

/** Canonical form of a typed binding: one chord, or up to MAX_STEPS chords separated by spaces. */
export function normalizeChord(text: string): string | null {
  const steps = text.trim().split(STEP_SPLIT);
  if (steps.length > MAX_STEPS) return null;
  const out: string[] = [];
  for (const step of steps) {
    const n = normalizeStep(step);
    if (!n) return null;
    out.push(n);
  }
  return out.join(' ');
}

export type ChordResult = { chord: string } | { error: string };

/** Like `normalizeChord`, but says why a binding is rejected. */
export function normalizeChordReason(text: string): ChordResult {
  const steps = text.trim().split(STEP_SPLIT);
  if (steps.length > MAX_STEPS) return { error: `more than ${MAX_STEPS} chords in "${text.trim()}"` };
  const out: string[] = [];
  for (const step of steps) {
    const n = stepResult(step);
    if ('error' in n) return n;
    out.push(n.chord);
  }
  return { chord: out.join(' ') };
}

/** Canonical form of one typed chord (any case, spaces, aliases); null when it isn't one. */
function normalizeStep(text: string): string | null {
  const r = stepResult(text);
  return 'chord' in r ? r.chord : null;
}

function stepResult(text: string): ChordResult {
  let body = text.replace(/\s+/g, '');
  let key: string | null = null;
  // A '+' key comes last: "+", "Ctrl++".
  if (body === '+') return { chord: '+' };
  if (body.endsWith('++')) {
    key = '+';
    body = body.slice(0, -2);
  }
  if (!body) return { error: 'empty chord' };
  const parts = body.split('+');
  const mods = new Set<Modifier>();
  for (const part of parts) {
    if (!part) return { error: `empty part in "${body}"` };
    const mod = MOD_ALIASES[part.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key) return { error: `more than one key in "${body}"` };
    key = normalizeKey(part);
    if (!key) return { error: `unknown key "${part}"` };
  }
  return key ? { chord: chord(mods, key) } : { error: `no key in "${body}"` };
}

/** One readable line for a conflict from `conflictsOf`: the chord and both (all) command ids. */
export function conflictMessage(c: { chord: string; ids: string[] }): string {
  return `${c.chord} is bound to ${c.ids.join(' and ')}`;
}

/** The chords each command has: its keymap entry when there is one (even []), else its defaults. */
export function effectiveKeys(defs: CommandDef[], keymap: Keymap): Map<string, string[]> {
  let byDefs = keysCache.get(keymap);
  if (!byDefs) keysCache.set(keymap, (byDefs = new WeakMap()));
  let keys = byDefs.get(defs);
  if (!keys) byDefs.set(defs, (keys = new Map(defs.map((d) => [d.id, Object.hasOwn(keymap, d.id) ? keymap[d.id] : d.keys]))));
  return keys;
}

/** Memo per keymap object then defs array; both are treated as immutable once passed in. */
const keysCache = new WeakMap<Keymap, WeakMap<CommandDef[], Map<string, string[]>>>();

/** Chords bound twice in one scope, or in global and a view; each chord once, with all ids. */
export function conflictsOf(defs: CommandDef[], keymap: Keymap): Array<{ chord: string; ids: string[] }> {
  const keys = effectiveKeys(defs, keymap);
  const byChord = new Map<string, CommandDef[]>();
  for (const d of defs) {
    for (const c of new Set(keys.get(d.id))) {
      const list = byChord.get(c) ?? [];
      list.push(d);
      byChord.set(c, list);
    }
  }
  const out: Array<{ chord: string; ids: string[] }> = [];
  for (const [c, list] of byChord) {
    if (list.length < 2) continue;
    const global = list.filter((d) => d.scope === GLOBAL);
    const views = new Map<string, number>();
    for (const d of list) if (d.scope !== GLOBAL) views.set(d.scope, (views.get(d.scope) ?? 0) + 1);
    const clash = global.length > 1 || (global.length > 0 && views.size > 0) || [...views.values()].some((n) => n > 1);
    if (!clash) continue;
    // Ids of views that only collide with other views aren't part of the conflict.
    const ids = global.length > 0 ? list.map((d) => d.id) : list.filter((d) => (views.get(d.scope) ?? 0) > 1).map((d) => d.id);
    out.push({ chord: c, ids });
  }
  // A binding that is the start of a longer one in an overlapping scope can never run the longer one.
  const overlap = (a: CommandDef, b: CommandDef) => a.scope === b.scope || a.scope === GLOBAL || b.scope === GLOBAL;
  const starts = new Map<string, Set<string>>();
  for (const [c, longList] of byChord) {
    const steps = stepsOf(c);
    for (let n = 1; n < steps.length; n++) {
      const prefix = steps.slice(0, n).join(' ');
      const shortList = byChord.get(prefix);
      if (!shortList) continue;
      const ids = starts.get(prefix) ?? new Set<string>();
      starts.set(prefix, ids);
      for (const s of shortList) {
        for (const l of longList) {
          if (s.id !== l.id && overlap(s, l)) {
            ids.add(s.id);
            ids.add(l.id);
          }
        }
      }
    }
  }
  for (const [prefix, ids] of starts) {
    if (ids.size) out.push({ chord: prefix, ids: defs.filter((d) => ids.has(d.id)).map((d) => d.id) });
  }
  return out;
}

/** Whether two bindings clash by being equal or one starting the other. */
export function relatedChords(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/** Whether a longer binding that starts with `steps` is bound to an applicable command in a view or global. */
export function startsOf(steps: string, scope: string, defs: CommandDef[], keymap: Keymap, { desktop = true }: { desktop?: boolean } = {}): CommandDef[] {
  const keys = effectiveKeys(defs, keymap);
  return defs.filter(
    (d) => (desktop || !d.desktopOnly) && (d.scope === GLOBAL || d.scope === scope) && keys.get(d.id)?.some((c) => c.startsWith(`${steps} `)),
  );
}

/** The command a chord runs in a view: the view's own first, then a global one. */
export function resolve(chordText: string, scope: string, defs: CommandDef[], keymap: Keymap, { desktop = true }: { desktop?: boolean } = {}): CommandDef | null {
  const keys = effectiveKeys(defs, keymap);
  const bound = defs.filter((d) => (desktop || !d.desktopOnly) && keys.get(d.id)?.includes(chordText));
  return bound.find((d) => d.scope === scope && scope !== GLOBAL) ?? bound.find((d) => d.scope === GLOBAL) ?? null;
}

/** Whether a def fires while typing in a field: its `inInput`, else when its chord has Ctrl, Alt or Meta. */
export function firesInInput(def: CommandDef, chordText: string): boolean {
  return def.inInput ?? /(^|\+)(Ctrl|Alt|Meta)\+/.test(stepsOf(chordText)[0]);
}

/** A keymap read back from settings, canonicalized; null when anything in it is off. */
export function validKeymap(raw: unknown): Keymap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_IDS) return null;
  const out: Keymap = {};
  for (const [id, chords] of entries) {
    if (!ID.test(id) || !Array.isArray(chords) || chords.length > MAX_CHORDS) return null;
    const list: string[] = [];
    for (const c of chords) {
      const n = typeof c === 'string' && c.length <= 100 ? normalizeChord(c) : null;
      if (!n) return null;
      list.push(n);
    }
    out[id] = list;
  }
  return out;
}

/** A container attribute: `data-keys="own"` keeps keys pressed inside it from app commands. */
export const OWN_KEYS_ATTR = 'data-keys';
/** Space-separated command ids that still fire inside a `data-keys="own"` container. */
export const ALLOW_KEYS_ATTR = 'data-keys-allow';

interface Closest {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** Whether a key event's target sits in a `data-keys="own"` container that doesn't allow command `id`. */
export function ownsKey(target: unknown, id: string): boolean {
  if (!target || typeof (target as Closest).closest !== 'function') return false;
  const owner = (target as Closest).closest(`[${OWN_KEYS_ATTR}="own"]`);
  if (!owner) return false;
  return !(owner.getAttribute(ALLOW_KEYS_ATTR) ?? '').split(/\s+/).includes(id);
}

/** A container attribute: `data-key-scope="<name>"` marks where commands with `focus: '<name>'` fire. */
export const KEY_SCOPE_ATTR = 'data-key-scope';

/** Whether a command with `focus` may fire for a key event on `target`: always without `focus`, else only inside `[data-key-scope="<focus>"]`. */
export function inFocusScope(target: unknown, focus: string | undefined): boolean {
  if (!focus) return true;
  if (!target || typeof (target as Closest).closest !== 'function') return false;
  return (target as Closest).closest(`[${KEY_SCOPE_ATTR}="${focus}"]`) !== null;
}
