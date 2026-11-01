// Small DOM helpers. All content is inserted as text, never as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') {
      // CSSOM, not the style attribute, so the Content-Security-Policy can forbid inline styles.
      for (const decl of String(v).split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Renders FTS snippet markers (\u0002…\u0003) as <mark>. */
export function snippet(s) {
  const frag = document.createDocumentFragment();
  const parts = String(s || '').split(/(\u0002[^\u0003]*\u0003)/);
  for (const p of parts) {
    if (p.startsWith('\u0002')) frag.append(h('mark', {}, p.slice(1, -1)));
    else if (p) frag.append(document.createTextNode(p));
  }
  return frag;
}

/** Highlights words beginning with any stem in `stems` inside plain text. */
export function highlighted(text, stems) {
  if (!stems || !stems.length || !text) return document.createTextNode(text || '');
  const esc = stems.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(\\b(?:${esc.join('|')})[\\p{L}\\p{N}]*)`, 'giu');
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(h('mark', {}, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

export function stemsFor(tokens) {
  return tokens.map(t => t.length > 5 ? t.replace(/(ing|ed|es|s)$/, '') : t).filter(t => t.length > 1);
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}` }, text);
}

export function banner(title, lines = [], kind = 'warn') {
  return h('div', { class: `banner ${kind}`, role: 'note' },
    h('strong', {}, title),
    lines.length ? h('ul', {}, lines.map(l => h('li', {}, l))) : null);
}

export function section(title, ...children) {
  return h('section', { class: 'group' }, title ? h('h2', { class: 'group-title' }, title) : null, h('div', { class: 'card' }, ...children));
}

export function row(href, title, sub, extra) {
  return h('a', { class: 'row', href }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, title), sub ? h('div', { class: 'row-sub' }, sub) : null, extra || null), h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

export function fmtDate(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtBytes(n) {
  if (n == null) return 'Unknown';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export const STATUS_LABEL = {
  'not-yet-in-force': 'Not yet in force',
  'repealed': 'Repealed',
  'annotation': 'Editorial note — not law',
  'unknown': 'Status unknown',
};

export const REVIEW_LABEL = {
  'interpretation-drafted': 'Draft — not legally reviewed',
  'legal-review-recorded': 'Legal review recorded',
  'approved': 'Approved',
};
