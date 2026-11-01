// Database worker: owns SQLite (WebAssembly), the on-device file pool, and package import.
// Nothing here makes a network request except loading the app's own files.
import sqlite3InitModule from '../vendor/sqlite3.js';
import * as ed from '../vendor/noble-ed25519.js';
import { TRUSTED_KEYS, APP_VERSION, SUPPORTED_SCHEMA, SUPPORTED_FORMAT } from './trusted-keys.js';
import { idbGet, idbPut, idbDeletePrefix, idbClear } from './idb.js';

const MAGIC = 'PHQPKG01';
let sqlite3 = null;
let pool = null;          // OPFS SyncAccessHandle pool, when available
let storageMode = null;   // 'opfs' | 'memory'
let db = null;
let openSlot = null;

async function init() {
  if (sqlite3) return;
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  try {
    pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'phq-pool', initialCapacity: 6, clearOnInit: false });
    storageMode = 'opfs';
  } catch (e) {
    pool = null;
    storageMode = 'memory';
  }
}

const dbName = slot => `/content-${slot}.sqlite`;

async function getState() {
  return (await idbGet('meta', 'state')) || { current: null, previous: null };
}

function closeDb() {
  if (db) { try { db.close(); } catch (_) {} }
  db = null; openSlot = null;
}

async function openSlotDb(slot, mode) {
  closeDb();
  if (mode === 'opfs') {
    if (!pool) throw new Error('On-device storage is busy or unavailable. Close any other Police HQ windows or tabs, then reopen the app.');
    db = new pool.OpfsSAHPoolDb(dbName(slot), 'r');
  } else {
    const blob = await idbGet('files', `${slot}/content.sqlite`);
    if (!blob) throw new Error('Installed database is missing.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    db = new sqlite3.oo1.DB(':memory:', 'c');
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, 'main', p, bytes.length, bytes.length,
      sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_READONLY);
    if (rc) throw new Error('Could not open installed database (code ' + rc + ').');
  }
  openSlot = slot;
}

async function ensureOpen() {
  await init();
  const st = await getState();
  if (!st.current) { closeDb(); return null; }
  if (openSlot !== st.current.slot || !db) await openSlotDb(st.current.slot, st.current.storage);
  return st;
}

function query(sql, params) {
  if (!db) throw new Error('No content installed.');
  return db.exec({ sql, bind: params && params.length ? params : undefined, rowMode: 'object', returnValue: 'resultRows' });
}

// ---------- package import ----------

const te = new TextDecoder();
const b64 = s => Uint8Array.from(atob(s.trim()), c => c.charCodeAt(0));
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

async function readSlice(file, start, end) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extract(file, base, e) {
  const start = base + Number(e.offset);
  const end = start + Number(e.length);
  if (!(start >= base && end <= file.size && end >= start)) throw new Error(`Entry outside the file: ${e.path}`);
  const blob = await readSlice(file, start, end);
  let data;
  if (e.compression === 'deflate-raw') data = await inflateRaw(blob);
  else if (e.compression === 'none') data = blob;
  else throw new Error(`Unknown compression for ${e.path}`);
  if (data.length !== Number(e.size)) throw new Error(`Size mismatch for ${e.path}`);
  return data;
}

function versionAtLeast(have, need) {
  const a = String(have).split('.').map(n => parseInt(n, 10) || 0);
  const b = String(need).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

const MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', json: 'application/json', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const mimeFor = p => MIME[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

async function cleanupSlot(slot) {
  await idbDeletePrefix('files', `${slot}/`);
  if (pool) { try { pool.unlink(dbName(slot)); } catch (_) {} }
}

async function install(file, progress) {
  await init();
  progress('Checking package', 0, 1);
  if (file.size < 16) throw new Error('This is not a Police HQ content package.');
  const head = await readSlice(file, 0, 16);
  if (te.decode(head.subarray(0, 8)) !== MAGIC) throw new Error('This is not a Police HQ content package.');
  const n = Number(new DataView(head.buffer).getBigUint64(8));
  if (n <= 0 || n > 50_000_000 || 16 + n > file.size) throw new Error('The package is damaged (bad index).');
  const index = JSON.parse(te.decode(await readSlice(file, 16, 16 + n)));
  const base = 16 + n;
  const entries = new Map();
  for (const e of index.entries || []) {
    const p = String(e.path || '');
    if (!p || p.startsWith('/') || p.split('/').includes('..') || p.includes('\\')) throw new Error(`Unsafe path in package: ${p}`);
    entries.set(p, e);
  }
  if (!entries.has('manifest.json') || !entries.has('manifest.sig')) throw new Error('The package has no signed manifest.');

  const manifestBytes = await extract(file, base, entries.get('manifest.json'));
  const sig = b64(te.decode(await extract(file, base, entries.get('manifest.sig'))));
  let signer = null;
  for (const k of TRUSTED_KEYS) {
    try {
      if (await ed.verifyAsync(sig, manifestBytes, b64(k.key))) { signer = k; break; }
    } catch (_) { /* try next key */ }
  }
  if (!signer) throw new Error('Signature not valid for any trusted key. The package was not installed.');
  const manifest = JSON.parse(te.decode(manifestBytes));
  if (manifest.format !== 'phq-content-package' || manifest.format_version !== SUPPORTED_FORMAT) throw new Error('Unsupported package format.');
  if (manifest.schema_version !== SUPPORTED_SCHEMA) throw new Error(`Incompatible content schema (${manifest.schema_version}).`);
  if (manifest.min_app_version && !versionAtLeast(APP_VERSION, manifest.min_app_version)) throw new Error(`This package needs app version ${manifest.min_app_version} or later.`);
  const listed = new Map((manifest.files || []).map(f => [f.path, f]));
  for (const p of entries.keys()) {
    if (p !== 'manifest.json' && p !== 'manifest.sig' && !listed.has(p)) throw new Error(`Unlisted file in package: ${p}`);
  }
  for (const p of listed.keys()) if (!entries.has(p)) throw new Error(`Missing file in package: ${p}`);
  if (!listed.has('content.sqlite')) throw new Error('The package has no content database.');

  const state = await getState();
  const slot = state.current && state.current.slot === 'A' ? 'B' : 'A';
  // Discard the old rollback copy first, so a failed import never touches the package in use.
  if (state.previous) {
    await idbPut('meta', 'state', { current: state.current, previous: null });
  }
  if (openSlot === slot) closeDb();
  await cleanupSlot(slot);

  const storage = storageMode;
  try {
    const total = listed.size;
    let done = 0;
    for (const [path, f] of listed) {
      progress(path === 'content.sqlite' ? 'Verifying and installing the database' : 'Verifying documents', done, total);
      let data = await extract(file, base, entries.get(path));
      if (data.length !== f.size || hex(await crypto.subtle.digest('SHA-256', data)) !== f.sha256) {
        throw new Error(`Hash mismatch for ${path}. The package was not installed.`);
      }
      if (path === 'content.sqlite') {
        if (storage === 'opfs') {
          await pool.reserveMinimumCapacity(6);
          pool.importDb(dbName(slot), data);
        } else {
          await idbPut('files', `${slot}/content.sqlite`, new Blob([data], { type: 'application/vnd.sqlite3' }));
        }
      } else {
        await idbPut('files', `${slot}/${path}`, new Blob([data], { type: mimeFor(path) }));
      }
      data = null;
      done++;
    }
    progress('Opening installed content', total, total);
    await openSlotDb(slot, storage);
    const info = Object.fromEntries(query('SELECT key, value FROM package_info').map(r => [r.key, r.value]));
    const nSources = query('SELECT count(*) AS n FROM sources')[0].n;
    if (String(info.schema_version) !== String(SUPPORTED_SCHEMA)) throw new Error('Database schema does not match the manifest.');
    if (info.source_count && Number(info.source_count) !== nSources) throw new Error('Database is incomplete.');
    query("SELECT rowid FROM provisions_fts WHERE provisions_fts MATCH 'act' LIMIT 1");
  } catch (e) {
    closeDb();
    await cleanupSlot(slot);
    const st = await getState();
    if (st.current) await openSlotDb(st.current.slot, st.current.storage).catch(() => {});
    throw e;
  }

  const record = {
    slot, storage,
    packageVersion: manifest.package_version,
    publishedAt: (manifest.content_info || {}).package_published_at || manifest.created_at,
    createdAt: manifest.created_at,
    signingKeyId: manifest.signing_key_id,
    trustedKeyId: signer.id,
    description: manifest.description || '',
    statement: manifest.statement || '',
    fileCount: listed.size,
    sourceCount: Number((manifest.content_info || {}).source_count) || null,
    importedAt: new Date().toISOString(),
  };
  const before = await getState();
  await idbPut('meta', 'state', { current: record, previous: before.current || null });
  return record;
}

async function rollback() {
  await init();
  const st = await getState();
  if (!st.previous) throw new Error('No previous package is available.');
  await openSlotDb(st.previous.slot, st.previous.storage);
  await idbPut('meta', 'state', { current: st.previous, previous: st.current });
  return getState();
}

async function deletePrevious() {
  await init();
  const st = await getState();
  if (!st.previous) return st;
  await idbPut('meta', 'state', { current: st.current, previous: null });
  await cleanupSlot(st.previous.slot);
  return getState();
}

async function eraseContent() {
  await init();
  closeDb();
  await idbPut('meta', 'state', { current: null, previous: null });
  await idbClear('files');
  if (pool) { try { await pool.wipeFiles(); } catch (_) {} }
  return getState();
}

// ---------- message loop ----------

self.onmessage = async (ev) => {
  const { id, type, payload } = ev.data || {};
  const reply = (ok, result) => self.postMessage({ id, ok, result });
  try {
    let result;
    switch (type) {
      case 'status': {
        await init();
        const st = await ensureOpen().catch(e => ({ error: String(e.message || e) }));
        const base = await getState();
        result = { ...base, storageMode, openError: st && st.error ? st.error : null, sqlite: sqlite3.version.libVersion };
        break;
      }
      case 'query': await ensureOpen(); result = query(payload.sql, payload.params); break;
      case 'install':
        result = await install(payload.file, (stage, done, total) => self.postMessage({ id, progress: { stage, done, total } }));
        break;
      case 'rollback': result = await rollback(); break;
      case 'deletePrevious': result = await deletePrevious(); break;
      case 'erase': result = await eraseContent(); break;
      default: throw new Error('Unknown request ' + type);
    }
    reply(true, result);
  } catch (e) {
    reply(false, String((e && e.message) || e));
  }
};
