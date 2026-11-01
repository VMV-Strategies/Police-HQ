// Page-side access to the content database (via the worker) and to the user's local records.
import { idbGet, idbPut, idbDelete, idbClear } from './idb.js';

const worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
worker.onmessage = (ev) => {
  const { id, ok, result, progress } = ev.data;
  const p = pending.get(id);
  if (!p) return;
  if (progress) { p.onProgress && p.onProgress(progress); return; }
  pending.delete(id);
  ok ? p.resolve(result) : p.reject(new Error(result));
};
worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'Database worker failed to start.')); pending.clear(); };

function call(type, payload, onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, type, payload });
  });
}

export const status = () => call('status');
export const install = (file, onProgress) => call('install', { file }, onProgress);
export const rollback = () => call('rollback');
export const deletePrevious = () => call('deletePrevious');
export const eraseContent = () => call('erase');
export const q = (sql, params = []) => call('query', { sql, params });

// ---------- constants mirrored from the Swift core ----------

export const LEVELS = [
  { id: 'constitutional', title: 'Constitutional' },
  { id: 'federal', title: 'Federal' },
  { id: 'provincial', title: 'Provincial (Ontario)' },
  { id: 'municipal', title: 'Municipal' },
];
export const MUNICIPALITIES = [
  { id: 'peel', title: 'Peel Region' },
  { id: 'brampton', title: 'Brampton' },
  { id: 'mississauga', title: 'Mississauga' },
];
export const AUTHORITY_CATEGORIES = [
  { id: 'arrest', title: 'Arrest', icon: '⛓' },
  { id: 'detention', title: 'Detention', icon: '✋' },
  { id: 'search', title: 'Search', icon: '🔍' },
  { id: 'seizure', title: 'Seizure', icon: '📦' },
  { id: 'entry', title: 'Entry', icon: '🚪' },
  { id: 'release', title: 'Release and post-action obligations', icon: '↪' },
];
export const STAGES = [
  { id: 'initial-interaction', title: 'Initial interaction' },
  { id: 'detention', title: 'Detention' },
  { id: 'arrest', title: 'Arrest' },
  { id: 'questioning', title: 'Questioning or statement-taking' },
  { id: 'search-seizure', title: 'Search or seizure' },
  { id: 'custody-release', title: 'Custody and release' },
];
export const EXPLANATION_LEVELS = [
  { id: 'very-simple', title: 'Very simple', key: 'very_simple' },
  { id: 'plain-language', title: 'Plain language', key: 'plain' },
  { id: 'detailed', title: 'Detailed', key: 'detailed' },
  { id: 'legal-analysis', title: 'Legal analysis', key: null },
];

export function reproductionNotice(level) {
  if (level === 'federal' || level === 'constitutional') return 'Unofficial reproduction — not an official version. Federal enactments reproduced under the Reproduction of Federal Law Order (SI/97-5); accuracy is not guaranteed.';
  if (level === 'provincial') return "Unofficial reproduction — not an official version. © King's Printer for Ontario (year of first publication as shown in the original).";
  return 'Unofficial copy as supplied — not an official version. Redistribution rights for this by-law have not been established.';
}

/** Removes Word field-code residue (e.g. HYPERLINK "…") that some e-Laws files leave in metadata. */
export function cleanMeta(s) {
  if (!s) return s;
  return String(s).replace(/&quot;/g, '"').replace(/HYPERLINK\s+"[^"]*"(\s*\\l\s*"[^"]*")?/g, '').replace(/\s+/g, ' ').trim();
}

export function currencyLine(src) {
  const parts = [];
  const c = cleanMeta(src.consolidation);
  const l = cleanMeta(src.last_amended);
  parts.push(c && c !== 'Unknown' ? c : 'Consolidation date unknown');
  if (l && l !== 'Unknown' && l.length > 3) parts.push(/^last/i.test(l) ? l : `Last amended ${l}`);
  parts.push(src.verification_status === 'Not verified' ? 'Not verified against publisher' : `Publisher check: ${src.verification_status}`);
  return parts.join(' · ');
}

// ---------- content queries ----------

export function sources({ level = null, municipality = null, text = '' } = {}) {
  let sql = `SELECT source_id, title, citation, abbreviations, doc_type, level, jurisdiction_label, municipality,
             consolidation, extraction_quality FROM sources WHERE 1=1`;
  const p = [];
  if (level) { sql += ' AND level = ?'; p.push(level); }
  if (municipality) { sql += ' AND municipality = ?'; p.push(municipality); }
  if (text.trim()) {
    sql += ` AND (title LIKE ? OR citation LIKE ? OR abbreviations LIKE ? OR source_id LIKE ?)`;
    const t = `%${text.trim()}%`;
    p.push(t, t, t, t);
  }
  sql += ` ORDER BY CASE level WHEN 'constitutional' THEN 0 WHEN 'federal' THEN 1 WHEN 'provincial' THEN 2 ELSE 3 END, municipality, title`;
  return q(sql, p);
}

export async function source(id) {
  return (await q('SELECT * FROM sources WHERE source_id = ?', [id]))[0] || null;
}

export async function provision(id) {
  return (await q('SELECT * FROM provisions WHERE provision_id = ?', [id]))[0] || null;
}

export function provisionsFrom(sourceId, fromOrdinal, limit = 120) {
  return q(`SELECT provision_id, parent_id, kind, number, path, label, heading, text, status, history, notes, page_start, ordinal, depth
            FROM provisions WHERE source_id = ? AND ordinal >= ? ORDER BY ordinal LIMIT ?`, [sourceId, fromOrdinal, limit]);
}

export function provisionsBefore(sourceId, beforeOrdinal, limit = 120) {
  return q(`SELECT * FROM (SELECT provision_id, parent_id, kind, number, path, label, heading, text, status, history, notes, page_start, ordinal, depth
            FROM provisions WHERE source_id = ? AND ordinal < ? ORDER BY ordinal DESC LIMIT ?) ORDER BY ordinal`, [sourceId, beforeOrdinal, limit]);
}

export function contents(sourceId, filter = '') {
  let sql = `SELECT provision_id, kind, label, heading, text, ordinal FROM provisions
             WHERE source_id = ? AND depth = 0 AND kind IN ('part','heading','section','schedule')`;
  const p = [sourceId];
  if (filter.trim()) {
    const f = filter.trim().replace(/^(s\.|section)\s*/i, '');
    sql += ` AND (number = ? OR path = ? OR label LIKE ? OR heading LIKE ? OR (kind IN ('part','heading') AND text LIKE ?))`;
    p.push(f, f, `%${f}%`, `%${f}%`, `%${f}%`);
  }
  sql += ' ORDER BY ordinal LIMIT 400';
  return q(sql, p);
}

export function pages(sourceId) {
  return q('SELECT page, text, ocr, image_only FROM pages WHERE source_id = ? ORDER BY page', [sourceId]);
}

// FTS match expressions are built from tokens only; user text is never passed as FTS syntax.
export function tokens(text) {
  return String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
export function matchExpression(text, mode) {
  const t = tokens(text);
  if (!t.length) return null;
  if (mode === 'phrase') return '"' + t.join(' ') + '"';
  return t.slice(0, -1).map(x => `"${x}"`).concat([`"${t[t.length - 1]}"*`]).join(' AND ');
}

const HS = '\u0002', HE = '\u0003';

function scopeClause(scope, alias) {
  const p = [];
  let c = '';
  if (scope.sourceId) { c += ` AND ${alias}.source_id = ?`; p.push(scope.sourceId); return [c, p]; }
  if (scope.levels && scope.levels.length && scope.levels.length < LEVELS.length) {
    c += ` AND s.level IN (${scope.levels.map(() => '?').join(',')})`; p.push(...scope.levels);
  }
  if (scope.municipalities && scope.municipalities.length && scope.municipalities.length < MUNICIPALITIES.length) {
    c += ` AND (s.level != 'municipal' OR s.municipality IN (${scope.municipalities.map(() => '?').join(',')}))`;
    p.push(...scope.municipalities);
  }
  return [c, p];
}

export async function search({ text, mode = 'keywords', scope = {}, includeNonOperative = false, limit = 80 }) {
  const inDoc = !!scope.sourceId;
  if (mode === 'section') {
    const cleaned = String(text).replace(/s\.|section/gi, '').replace(/\s+/g, '');
    if (!cleaned) return [];
    const [c, p] = scopeClause(scope, 'p');
    return q(`SELECT p.provision_id, p.source_id, s.title AS source_title, s.jurisdiction_label, p.label, p.heading,
              substr(coalesce(p.text,''),1,160) AS snippet, p.status, p.ordinal, NULL AS page
              FROM provisions p JOIN sources s ON s.source_id = p.source_id
              WHERE (p.path = ? OR p.path LIKE ?) AND p.status = 'in-force'${c}
              ORDER BY p.source_id, p.ordinal LIMIT ?`, [cleaned, `%:${cleaned}`, ...p, limit]);
  }
  const match = matchExpression(text, mode);
  if (!match) return [];
  const [c, p] = scopeClause(scope, 'p');
  const status = includeNonOperative ? '' : ` AND p.status IN ('in-force','repealed','unknown')`;
  const hits = await q(`SELECT p.provision_id, p.source_id, s.title AS source_title, s.jurisdiction_label, p.label, p.heading,
      snippet(provisions_fts, 2, '${HS}', '${HE}', '…', 14) AS snippet, p.status, p.ordinal, NULL AS page
      FROM provisions_fts JOIN provisions p ON p.rowid = provisions_fts.rowid
      JOIN sources s ON s.source_id = p.source_id
      WHERE provisions_fts MATCH ?${c}${status}
      ORDER BY ${inDoc ? 'p.ordinal' : 'bm25(provisions_fts, 5.0, 3.0, 1.0)'} LIMIT ?`, [match, ...p, limit]);
  const [gc, gp] = scopeClause(scope, 'g');
  const pageHits = await q(`SELECT NULL AS provision_id, g.source_id, s.title AS source_title, s.jurisdiction_label,
      'Page ' || g.page || CASE WHEN g.ocr THEN ' (OCR, unverified)' ELSE '' END AS label, NULL AS heading,
      snippet(pages_fts, 0, '${HS}', '${HE}', '…', 14) AS snippet, 'unknown' AS status, 1000000 + g.page AS ordinal, g.page AS page
      FROM pages_fts JOIN pages g ON g.rowid = pages_fts.rowid
      JOIN sources s ON s.source_id = g.source_id
      WHERE pages_fts MATCH ? AND s.extraction_quality IN ('heuristic-structure','image-only')${gc}
      ORDER BY ${inDoc ? 'g.page' : 'bm25(pages_fts)'} LIMIT ?`, [match, ...gp, Math.max(10, Math.floor(limit / 4))]);
  return hits.concat(pageHits).slice(0, limit + 20);
}

export function guideEntries(kind, category = null) {
  return category
    ? q('SELECT * FROM guide_entries WHERE kind = ? AND category = ? ORDER BY title', [kind, category])
    : q('SELECT * FROM guide_entries WHERE kind = ? ORDER BY title', [kind]);
}

export async function guideEntry(id) {
  const e = (await q('SELECT * FROM guide_entries WHERE entry_id = ?', [id]))[0];
  if (!e) return null;
  e.body = JSON.parse(e.body_json || '{}');
  e.citations = await q(`SELECT c.rowid AS n, c.role, c.source_id, c.provision_id, c.pinpoint, c.excerpt, s.title AS source_title, s.jurisdiction_label
                         FROM guide_citations c JOIN sources s ON s.source_id = c.source_id WHERE c.entry_id = ? ORDER BY c.rowid`, [id]);
  return e;
}

export async function guideTitles(ids) {
  if (!ids || !ids.length) return {};
  const rows = await q(`SELECT entry_id, title FROM guide_entries WHERE entry_id IN (${ids.map(() => '?').join(',')})`, ids);
  return Object.fromEntries(rows.map(r => [r.entry_id, r.title]));
}

export const coverageGaps = () => q('SELECT * FROM coverage_gaps ORDER BY category, title');
export const penaltyComponents = (offenceId) => q('SELECT * FROM penalty_components WHERE offence_entry_id = ? ORDER BY component_id', [offenceId]);
export const reviewCount = async () => (await q('SELECT count(*) AS n FROM review_records'))[0].n;

// ---------- the user's own local records (never sent anywhere) ----------

export async function getSetting(key, fallback) {
  const s = (await idbGet('user', 'settings')) || {};
  return key in s ? s[key] : fallback;
}
export async function setSetting(key, value) {
  const s = (await idbGet('user', 'settings')) || {};
  s[key] = value;
  await idbPut('user', 'settings', s);
}
export const bookmarks = async () => (await idbGet('user', 'bookmarks')) || [];
export async function toggleBookmark(b) {
  const list = await bookmarks();
  const i = list.findIndex(x => x.provisionId === b.provisionId);
  if (i >= 0) list.splice(i, 1); else list.unshift({ ...b, savedAt: new Date().toISOString() });
  await idbPut('user', 'bookmarks', list);
  return i < 0;
}
export const savedSearches = async () => (await idbGet('user', 'searches')) || [];
export async function saveSearch(s) {
  const list = await savedSearches();
  list.unshift({ ...s, savedAt: new Date().toISOString() });
  await idbPut('user', 'searches', list.slice(0, 50));
}
export async function deleteSavedSearch(i) {
  const list = await savedSearches();
  list.splice(i, 1);
  await idbPut('user', 'searches', list);
}
export async function eraseUserRecords() {
  await idbClear('user');
}
export async function original(slot, path) {
  return idbGet('files', `${slot}/${path}`);
}
export { idbDelete };
