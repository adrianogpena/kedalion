/**
 * In-page helper library (an expression that installs `window.__kd` once and returns it).
 * Elements are addressed by refs `e1..` kept in `__kd.els`; `__kd.reset()` (browser_snapshot) and
 * navigation invalidate them. Text is never passed through querySelector.
 */
export const PAGE_LIB = String.raw`(() => {
if (window.__kd && window.__kd.v === 4) return window.__kd;
const kd = { v: 4, els: [], map: new WeakMap(), last: [] };
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
  const root = scope && typeof scope === 'object' ? scope : scope ? kd.scopeEl(scope) : document;
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
kd.sameLink = (idx) => {
  const hrefs = idx.map((i) => { const el = kd.last[i]; const a = el && (el.closest('a[href]') || (el.matches('a[href]') ? el : null)); return a ? a.href : ''; });
  return hrefs.length > 1 && hrefs[0] !== '' && hrefs.every((h) => h === hrefs[0]);
};
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
  if (!document.body) return out;
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
kd.challenge = () => {
  const t = document.title || '';
  const has = (s) => { try { return !!document.querySelector(s); } catch (e) { return false; } };
  if (has('iframe[src*="challenges.cloudflare.com"],#challenge-form,#challenge-stage,#cf-challenge-running,.cf-turnstile') || /^(just a moment|attention required)/i.test(t)) return 'Cloudflare';
  if (has('iframe[src*="hcaptcha.com"]')) return 'hCaptcha';
  if (/verify you are human|checking your browser|are you a robot/i.test(t + ' ' + (document.body?.innerText || '').slice(0, 400))) return 'bot check';
  return null;
};
const MAIN = ['#mw-content-text', 'main', '[role=main]', 'article', '#content', '#main', '.entry-content', '.post-content'];
kd.mainEl = () => {
  for (const s of MAIN) {
    const hits = [...document.querySelectorAll(s)].filter((e) => vis(e) && (e.innerText || '').length > 200);
    if (hits.length) return hits.reduce((a, b) => ((b.innerText || '').length > (a.innerText || '').length ? b : a));
  }
  let best = document.body, score = 0;
  for (const el of document.querySelectorAll('div,section')) {
    let s = 0;
    for (const c of el.children) if (c.tagName === 'P' || /^H[1-6]$/.test(c.tagName) || c.tagName === 'UL' || c.tagName === 'TABLE') s += (c.innerText || '').length;
    if (s > score) { score = s; best = el; }
  }
  return best;
};
kd.rootOf = (scope, main) => (main ? kd.mainEl() : kd.scopeEl(scope));
kd.srcOf = (img) => {
  const cands = [img.currentSrc, img.getAttribute('data-src'), img.getAttribute('data-lazy-src'), img.getAttribute('data-original'), (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',').pop().trim().split(' ')[0], img.src];
  const good = cands.find((u) => u && !u.startsWith('data:'));
  try { return good ? new URL(good, location.href).href : (img.src || ''); } catch (e) { return good || ''; }
};
const bgUrl = (el) => { const m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(el).backgroundImage || ''); if (!m || m[1].startsWith('data:')) return null; try { return new URL(m[1], location.href).href; } catch (e) { return null; } };
const nearHeading = (el) => {
  const cap = el.closest('figure')?.querySelector('figcaption') || el.closest('.thumb,.image')?.querySelector('.thumbcaption,.caption');
  if (cap) return clean(cap.textContent);
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  let h = null;
  for (const x of hs) { if (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) h = x; else break; }
  return h ? clean(h.textContent) : '';
};
const nameFromUrl = (u) => { try { const parts = new URL(u).pathname.split('/').filter(Boolean).map(decodeURIComponent); return parts.reverse().find((p) => /\.[a-z0-9]{2,5}$/i.test(p)) || parts[0] || u; } catch (e) { return u; } };
kd.images = (scope, main) => {
  const root = kd.rootOf(scope, main);
  if (!root) return { error: 'No container matches scope: ' + scope };
  const imgs = [...root.querySelectorAll('img')].slice(0, 400).map((img) => {
    const src = kd.srcOf(img);
    const placeholder = (img.currentSrc || img.src || '').startsWith('data:') || img.naturalWidth <= 1;
    const loaded = img.complete && !placeholder;
    const w = (!placeholder && img.naturalWidth) || Number(img.getAttribute('width')) || 0, h = (!placeholder && img.naturalHeight) || Number(img.getAttribute('height')) || 0;
    const a = img.closest('a[href]');
    return { ref: kd.ref(img), name: img.getAttribute('data-image-name') || nameFromUrl(src), alt: clean(img.alt), src, w, h, loaded, near: cut(nearHeading(img), 60), link: a ? a.href : undefined };
  }).filter((i) => i.src);
  const sheets = new Map();
  const others = [];
  let n = 0;
  for (const el of root.querySelectorAll('*')) {
    if (++n > 6000) break;
    if (el.tagName === 'IMG') continue;
    const u = bgUrl(el);
    if (!u) continue;
    const s = getComputedStyle(el);
    const pos = s.backgroundPosition;
    const entry = { ref: kd.ref(el), name: clean(el.closest('a[title]')?.getAttribute('title') || el.getAttribute('title') || el.getAttribute('aria-label') || el.closest('a')?.textContent || ''), pos, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) };
    if (!sheets.has(u)) sheets.set(u, []);
    sheets.get(u).push(entry);
  }
  const sprites = [];
  for (const [u, list] of sheets) {
    if (list.length > 1 && new Set(list.map((x) => x.pos)).size > 1) sprites.push({ sheet: u, name: nameFromUrl(u), count: list.length, cells: list.slice(0, 300) });
    else for (const x of list) { const el = kd.byRef(x.ref); others.push({ ref: x.ref, name: nameFromUrl(u), alt: x.name, src: u, w: x.w, h: x.h, loaded: true, near: el ? cut(nearHeading(el), 60) : '', css: true }); }
  }
  return { images: imgs.concat(others), sprites };
};
kd.loadLazy = async () => {
  for (const img of document.querySelectorAll('img')) {
    if (img.loading === 'lazy') img.loading = 'eager';
    const ds = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    if (ds && (!img.getAttribute('src') || img.src.startsWith('data:') || img.naturalWidth <= 1)) img.src = ds;
    const dss = img.getAttribute('data-srcset');
    if (dss && !img.getAttribute('srcset')) img.setAttribute('srcset', dss);
  }
  const start = scrollY;
  const step = Math.max(innerHeight * 0.8, 400);
  for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 80; y += step, i++) {
    scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 60));
  }
  scrollTo(0, start);
  const pending = [...document.images].filter((i) => !i.complete);
  await Promise.race([Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), new Promise((r) => setTimeout(r, 3000))]);
  return { images: document.images.length, waited: pending.length };
};
const SKIP_MD = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|INPUT|SELECT|TEXTAREA|FORM|NAV|IFRAME)$/;
const NOISE = '.mw-editsection,.editsection,.noprint,.navbox,.toc,[role=navigation],.reference,.mw-cite-backlink';
const noise = (el) => { try { return el.matches(NOISE); } catch (e) { return false; } };
const IMG_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\/|\?|$)/i;
kd.markdown = (scope, main) => {
  const root = kd.rootOf(scope, main);
  if (!root) return { error: 'No container matches scope: ' + scope };
  const esc = (s) => s.replace(/\|/g, '\\|');
  const inline = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += c.textContent.replace(/\s+/g, ' '); continue; }
      if (c.nodeType !== 1 || SKIP_MD.test(c.tagName) || noise(c) || c.getAttribute('aria-hidden') === 'true' || (c.offsetParent === null && getComputedStyle(c).display === 'none')) continue;
      const t = c.tagName;
      if (t === 'BR') out += '\n';
      else if (t === 'IMG') { const s = kd.srcOf(c); if (s) out += '![' + clean(c.alt || c.getAttribute('data-image-name') || nameFromUrl(s)) + '](' + s + ')'; }
      else if (t === 'A' && c.getAttribute('href') && !c.getAttribute('href').startsWith('javascript:')) {
        const own = clean(inline(c));
        if (/^!\[[^\]]*\]\([^)]*\)$/.test(own) && IMG_FILE.test(c.href)) { out += own; continue; }
        const twin = (x) => x && x.tagName === 'A' && x.href === c.href;
        if (!own && (twin(c.previousElementSibling) || twin(c.nextElementSibling))) continue;
        const txt = own || clean(c.getAttribute('title') || '');
        out += txt ? '[' + txt + '](' + c.href + ')' : '';
      }
      else if (t === 'STRONG' || t === 'B') { const x = clean(inline(c)); out += x ? '**' + x + '**' : ''; }
      else if (t === 'EM' || t === 'I') { const x = clean(inline(c)); out += x ? '*' + x + '*' : ''; }
      else if (t === 'CODE') out += '\x60' + c.textContent + '\x60';
      else out += inline(c);
    }
    return out;
  };
  const blocks = [];
  const table = (tb) => {
    const rows = [...tb.rows].map((r) => [...r.cells].map((c) => esc(clean(inline(c).replace(/\n/g, ' ')))));
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(cols - r.length).fill(''));
    const lines = ['| ' + pad(rows[0]).join(' | ') + ' |', '|' + ' --- |'.repeat(cols)];
    for (const r of rows.slice(1)) lines.push('| ' + pad(r).join(' | ') + ' |');
    blocks.push(lines.join('\n'));
  };
  const list = (el, depth) => {
    let i = 0;
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      i++;
      const own = [...li.childNodes].filter((c) => !(c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)));
      const holder = document.createElement('span');
      for (const c of own) holder.appendChild(c.cloneNode(true));
      const text = clean(inline(holder));
      if (text) blocks.push('  '.repeat(depth) + (el.tagName === 'OL' ? i + '. ' : '- ') + text);
      for (const sub of li.children) if (/^(UL|OL)$/.test(sub.tagName)) list(sub, depth + 1);
    }
  };
  const walk = (el) => {
    for (const c of el.children) {
      const t = c.tagName;
      if (SKIP_MD.test(t) || noise(c) || c.getAttribute('aria-hidden') === 'true' || (!vis(c) && t !== 'TABLE')) continue;
      if (/^H[1-6]$/.test(t)) { const x = clean(inline(c)); if (x) blocks.push('#'.repeat(Number(t[1])) + ' ' + x); }
      else if (t === 'P' || t === 'FIGCAPTION' || t === 'DT' || t === 'DD') { const x = inline(c).replace(/[ \t]+/g, ' ').trim(); if (x) blocks.push(x); }
      else if (t === 'UL' || t === 'OL') list(c, 0);
      else if (t === 'TABLE') table(c);
      else if (t === 'PRE') blocks.push('\x60\x60\x60\n' + c.innerText + '\n\x60\x60\x60');
      else if (t === 'BLOCKQUOTE') { const x = clean(inline(c)); if (x) blocks.push('> ' + x); }
      else if (t === 'HR') blocks.push('---');
      else if (t === 'IMG') { const x = inline({ childNodes: [c] }); if (x) blocks.push(x); }
      else if (c.children.length && [...c.children].some((k) => /^(P|H[1-6]|UL|OL|TABLE|DIV|SECTION|ARTICLE|FIGURE|PRE|BLOCKQUOTE|DL|HR|IMG|ASIDE|MAIN|HEADER|FOOTER|CENTER)$/.test(k.tagName))) walk(c);
      else { const x = inline(c).replace(/[ \t]+/g, ' ').trim(); if (x) blocks.push(x); }
    }
  };
  walk(root === document ? document.body : root);
  return { title: document.title, url: location.href, markdown: blocks.join('\n\n') };
};
kd.snapshot = (scope, withClickable, main, withImages) => {
  kd.reset();
  const root = kd.rootOf(scope, main);
  if (!root) return { error: 'No container matches scope: ' + scope };
  const q = (s) => [...root.querySelectorAll(s)];
  const css = (el) => { if (el.id) return '#' + CSS.escape(el.id); const n = el.getAttribute('name'); const t = el.tagName.toLowerCase(); return n ? t + '[name="' + n.replace(/"/g, '\\"') + '"]' : t; };
  const labelOf = (el) => clean(el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '');
  const fieldsAll = q('input,select,textarea,button').filter(vis);
  const base = root === document ? document.body : root;
  return {
    title: document.title,
    url: location.href,
    headings: q('h1,h2,h3,h4,h5,h6').filter(vis).map((h) => { const c = h.cloneNode(true); for (const n of c.querySelectorAll(NOISE)) n.remove(); return { level: Number(h.tagName[1]), text: clean(c.textContent).replace(/\[\]$/, '') }; }).filter((h) => h.text),
    links: q('a[href]').filter(vis).map((a) => ({ text: clean(a.textContent || a.getAttribute('aria-label')), href: a.href })),
    fields: fieldsAll.slice(0, 400).map((f) => {
      const tag = f.tagName.toLowerCase();
      const type = f.getAttribute('type')?.toLowerCase() || undefined;
      const isButton = tag === 'button' || type === 'submit' || type === 'button';
      const value = isButton ? undefined : type === 'password' ? (f.value ? '***' : '') : type === 'checkbox' || type === 'radio' ? (f.checked ? 'checked' : 'unchecked') : String(f.value ?? '');
      return { tag, type, name: f.getAttribute('name') || undefined, label: isButton ? clean(f.textContent || f.value) : labelOf(f), value, selector: css(f), ref: kd.ref(f) };
    }),
    clickable: withClickable ? kd.collect('click', root).filter((el) => textOf(el) || el.matches('input,select,textarea')).slice(0, 400).map((el) => ({ ref: kd.ref(el), tag: el.tagName.toLowerCase(), text: cut(textOf(el), 80), state: stateOf(el) })) : undefined,
    images: withImages ? kd.images(scope, main) : undefined,
    challenge: kd.challenge() || undefined,
    text: clean(base?.innerText),
  };
};
return kd;
})()`;
