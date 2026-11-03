/**
 * In-page helper library (an expression that installs `window.__kd` once and returns it).
 * Elements are addressed by refs `e1..` kept in `__kd.els`; `__kd.reset()` (browser_snapshot) and
 * navigation invalidate them. Text is never passed through querySelector.
 */
export const PAGE_LIB = String.raw`(() => {
if (window.__kd && window.__kd.v === 3) return window.__kd;
const kd = { v: 3, els: [], map: new WeakMap(), last: [] };
window.__kd = kd;
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const vis = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
};
kd.vis = vis;
kd.ref = (el) => {
  let r = kd.map.get(el);
  if (!r) { kd.els.push(el); r = 'e' + kd.els.length; kd.map.set(el, r); }
  return r;
};
kd.byRef = (ref) => {
  const n = Number(String(ref).slice(1));
  const el = Number.isInteger(n) ? kd.els[n - 1] : null;
  if (el && el.isConnected) return el;
  const again = el && el.id ? document.getElementById(el.id) : null;
  if (again) { kd.els[n - 1] = again; kd.map.set(again, ref); return again; }
  return null;
};
kd.reset = () => { kd.els = []; kd.map = new WeakMap(); kd.last = []; };
const textOf = (el) => {
  const tag = el.tagName;
  if (tag === 'INPUT' && /^(button|submit|reset)$/.test(el.type)) return clean(el.value);
  return clean(el.innerText ?? el.textContent) || clean(el.getAttribute('aria-label') || el.getAttribute('title') || '');
};
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '...' : s);
kd.desc = (el) => {
  if (!el) return 'nothing';
  const t = textOf(el);
  return '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '>' + (t ? ' "' + cut(t, 60) + '"' : '');
};
const CLICK = 'a[href],button,summary,select,input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio],[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=option],[role=treeitem],[role=checkbox],[role=switch],[onclick]';
const clickable = (el) => {
  if (el.matches(CLICK)) return true;
  const t = el.tagName;
  if (t === 'TD' || t === 'DIV' || t === 'SPAN' || t === 'LI' || t === 'IMG' || t === 'I') {
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (cls.includes('button')) return true;
    if (getComputedStyle(el).cursor === 'pointer') {
      const p = el.parentElement;
      return !p || getComputedStyle(p).cursor !== 'pointer';
    }
  }
  return false;
};
const FIELD = 'input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=""],[contenteditable=true],[role=textbox],[role=combobox]';
const preceding = (el) => {
  let n = el;
  for (let d = 0; d < 4 && n && n !== document.body; d++, n = n.parentElement) {
    const p = n.previousElementSibling;
    if (p) {
      const t = clean(p.innerText ?? p.textContent);
      if (t && t.length <= 80) return t;
    } else {
      let s = n.previousSibling;
      while (s && s.nodeType === 3 && !clean(s.textContent)) s = s.previousSibling;
      if (s && s.nodeType === 3) return clean(s.textContent);
    }
  }
  return '';
};
const fieldTexts = (el) => {
  const out = [];
  if (el.labels) for (const l of el.labels) out.push(clean(l.textContent));
  for (const a of ['aria-label', 'placeholder', 'title']) out.push(clean(el.getAttribute(a)));
  const lb = el.getAttribute('aria-labelledby');
  if (lb) out.push(clean(lb.split(' ').map((i) => document.getElementById(i)?.textContent ?? '').join(' ')));
  out.push(preceding(el));
  return out.filter(Boolean);
};
const stateOf = (el) => {
  const s = [];
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') s.push('disabled');
  if (el.checked) s.push('checked');
  if (el.getAttribute('aria-selected') === 'true') s.push('selected');
  if (el.getAttribute('aria-expanded')) s.push(el.getAttribute('aria-expanded') === 'true' ? 'expanded' : 'collapsed');
  if (el === document.activeElement) s.push('focused');
  return s.join(',');
};
kd.scopeEl = (spec) => {
  if (!spec) return document;
  try { const el = document.querySelector(spec); if (el) return el; } catch (e) {}
  const q = spec.toLowerCase();
  let best = null;
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !(el.innerText || '').toLowerCase().includes(q)) continue;
    if (!best || best.contains(el)) best = el;
  }
  return best;
};
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
kd.collect = (kind, scope, exclude) => {
  const root = scope ? kd.scopeEl(scope) : document;
  if (!root) return [];
  const ex = exclude ? kd.byRef(exclude) : null;
  const all = [...root.querySelectorAll(kind === 'text' ? '*' : 'td,div,span,li,a,button,input,select,textarea,summary,img,i,[role],[onclick],[contenteditable]')];
  let els;
  if (kind === 'click') els = all.filter((e) => vis(e) && clickable(e));
  else if (kind === 'field') els = all.filter((e) => e.matches(FIELD) && vis(e));
  else els = all.filter((e) => !/^(SCRIPT|STYLE|NOSCRIPT|HTML|BODY|HEAD)$/.test(e.tagName) && vis(e) && !(ex && (e === ex || ex.contains(e))) && textOf(e).length > 0 && textOf(e).length <= 120);
  const set = new Set(els);
  const drop = new Set();
  const key = (e) => (kind === 'field' ? '' : textOf(e));
  if (kind !== 'field') {
    for (const e of els) {
      for (let p = e.parentElement; p; p = p.parentElement) {
        if (set.has(p) && key(p) === key(e)) { drop.add(p); }
      }
    }
  }
  return els.filter((e) => !drop.has(e));
};
kd.cands = (kind, scope, exclude) => {
  const els = kd.collect(kind, scope, exclude).slice(0, 600);
  kd.last = els;
  return els.map((el, i) => {
    const t = textOf(el);
    const texts = kind === 'field' ? fieldTexts(el) : [t, clean(el.getAttribute('aria-label')), clean(el.getAttribute('title'))].filter(Boolean);
    return { i, tag: el.tagName.toLowerCase(), text: kind === 'field' ? (texts[0] ?? '') : cut(t, 80), texts, ...rectOf(el) };
  });
};
kd.refs = (idx) => idx.map((i) => kd.ref(kd.last[i]));
kd.findSelector = (sel) => {
  let el;
  try { el = document.querySelector(sel); } catch (e) { return { error: 'Invalid selector: ' + sel }; }
  return el ? { ref: kd.ref(el) } : { error: 'No element matches ' + sel };
};
const frames = (n) => new Promise((res) => {
  let c = 0;
  const step = () => { if (++c >= n) res(); else requestAnimationFrame(step); };
  requestAnimationFrame(step);
  setTimeout(res, 120);
});
kd.probe = async (ref) => {
  const el = kd.byRef(ref);
  if (!el) return { gone: true };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  if (!vis(el)) return { reason: 'not visible' };
  const rect = () => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const a = rect();
  await frames(2);
  const b = rect();
  if (a.some((v, i) => Math.abs(v - b[i]) > 0.5)) return { reason: 'still moving' };
  const l = Math.max(b[0], 0), t = Math.max(b[1], 0), r = Math.min(b[0] + b[2], innerWidth), bt = Math.min(b[1] + b[3], innerHeight);
  if (r <= l || bt <= t) return { reason: 'outside the viewport' };
  const x = (l + r) / 2, y = (t + bt) / 2;
  const top = document.elementFromPoint(x, y);
  const ok = top && (el === top || el.contains(top) || (top !== document.body && top !== document.documentElement && top.contains(el)));
  if (!ok) return { reason: 'covered by ' + kd.desc(top), x, y };
  return { ok: true, x, y };
};
kd.info = (ref) => {
  const el = kd.byRef(ref);
  if (!el) return null;
  return { tag: el.tagName.toLowerCase(), desc: kd.desc(el), editable: !!(el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') };
};
kd.valueOf = (ref) => {
  const el = kd.byRef(ref);
  if (!el) return '';
  if (el.tagName === 'SELECT') return clean(el.selectedOptions[0]?.textContent ?? el.value);
  return 'value' in el && el.tagName !== 'LI' ? String(el.value) : textOf(el);
};
kd.focus = (ref, select) => {
  const el = kd.byRef(ref);
  if (!el) return false;
  el.focus();
  if (select) {
    if (el.select) el.select();
    else { const s = getSelection(); const r = document.createRange(); r.selectNodeContents(el); s.removeAllRanges(); s.addRange(r); }
  }
  return true;
};
kd.finishInput = (ref, wanted) => {
  const el = kd.byRef(ref);
  if (!el) return '';
  if (wanted !== null && 'value' in el && el.value !== wanted) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (set) set.call(el, wanted); else el.value = wanted;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return kd.valueOf(ref);
};
kd.selectNative = (ref, option) => {
  const el = kd.byRef(ref);
  const q = clean(option).toLowerCase();
  const opts = [...el.options];
  const hit = opts.find((o) => clean(o.textContent).toLowerCase() === q) || opts.find((o) => clean(o.textContent).toLowerCase().includes(q));
  if (!hit) return { error: 'No option "' + option + '"; options: ' + opts.slice(0, 15).map((o) => clean(o.textContent)).join(' | ') };
  el.value = hit.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { value: clean(hit.textContent) };
};
kd.texts = () => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n && out.length < 800; n = w.nextNode()) {
    const t = clean(n.textContent);
    const p = n.parentElement;
    if (t && p && !/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) && vis(p)) out.push(cut(t, 80));
  }
  return out;
};
kd.focusInfo = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return '';
  const v = el.type === 'password' ? '***' : ('value' in el ? String(el.value) : '');
  return kd.desc(el) + ('value' in el ? ' = ' + JSON.stringify(cut(v, 80)) : '');
};
kd.opener = (ref) => {
  const el = kd.byRef(ref);
  if (!el) return null;
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const ex = p.getAttribute('aria-expanded');
    if (ex === 'true') return { expanded: true };
    if (ex === 'false') return { ref: kd.ref(p) };
  }
  const row = el.closest('tr') || el.parentElement;
  const o = row && [...row.querySelectorAll('[class*=opener i],[class*=expand i],[class*=toggle i],[class*=arrow i],[class*=twisty i]')].find(vis);
  return o ? { ref: kd.ref(o) } : null;
};
kd.snapshot = (scope, withClickable) => {
  kd.reset();
  const root = kd.scopeEl(scope);
  if (!root) return { error: 'No container matches scope: ' + scope };
  const q = (s) => [...root.querySelectorAll(s)];
  const css = (el) => { if (el.id) return '#' + CSS.escape(el.id); const n = el.getAttribute('name'); const t = el.tagName.toLowerCase(); return n ? t + '[name="' + n.replace(/"/g, '\\"') + '"]' : t; };
  const labelOf = (el) => clean(el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
  const fieldsAll = q('input,select,textarea,button').filter(vis);
  const base = root === document ? document.body : root;
  return {
    title: document.title,
    url: location.href,
    headings: q('h1,h2,h3,h4,h5,h6').filter(vis).map((h) => ({ level: Number(h.tagName[1]), text: clean(h.textContent) })).filter((h) => h.text),
    links: q('a[href]').filter(vis).map((a) => ({ text: clean(a.textContent || a.getAttribute('aria-label')), href: a.href })),
    fields: fieldsAll.slice(0, 400).map((f) => {
      const tag = f.tagName.toLowerCase();
      const type = f.getAttribute('type') || undefined;
      const isButton = tag === 'button' || type === 'submit' || type === 'button';
      const value = isButton ? undefined : type === 'password' ? (f.value ? '***' : '') : String(f.value ?? '');
      return { tag, type, name: f.getAttribute('name') || undefined, label: isButton ? clean(f.textContent || f.value) : labelOf(f), value, selector: css(f), ref: kd.ref(f) };
    }),
    clickable: withClickable ? kd.collect('click', scope).filter((el) => textOf(el) || el.matches('input,select,textarea')).slice(0, 400).map((el) => ({ ref: kd.ref(el), tag: el.tagName.toLowerCase(), text: cut(textOf(el), 80), state: stateOf(el) })) : undefined,
    text: clean(base?.innerText),
  };
};
return kd;
})()`;
