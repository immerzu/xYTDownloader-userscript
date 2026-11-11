// Regressionstest: fetchRangeChunk (v1.1.18)
// Prüft den 302-/Status-0-Fallback: Range als Query-Parameter, bei Netzwerkfehler
// genau EIN Wiederholungsversuch mit HTTP-Range-Header.
// Ausführen: node tests/test-range-fallback.mjs   (Exit 0 = bestanden)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'xyt-downloader.user.js'), 'utf8');

const START = '// #region fetchRangeChunk';
const END = '// #endregion fetchRangeChunk';
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a < 0 || b < 0 || b <= a) {
  console.error('FAIL: Region fetchRangeChunk nicht gefunden');
  process.exit(1);
}
const fnSrc = src.slice(a + START.length, b);

function makeChunkFn(fetchImpl) {
  const safeMediaUrl = (raw) => {
    const u = new URL(String(raw));
    if (u.protocol !== 'https:' || (u.hostname !== 'googlevideo.com' && !u.hostname.endsWith('.googlevideo.com'))) {
      throw new Error('ungültige Medien-URL');
    }
    return u.href;
  };
  const readResponseLimited = async (res, maxBytes) => {
    const ab = await res.arrayBuffer();
    if (Number.isFinite(maxBytes) && ab.byteLength > maxBytes) {
      const e = new Error('Antwort zu groß'); e.tooLarge = true; throw e;
    }
    return ab;
  };
  const factory = new Function('safeMediaUrl', 'readResponseLimited', 'CHUNK_TIMEOUT_MS', 'fetch',
    fnSrc + '\nreturn fetchRangeChunk;');
  return factory(safeMediaUrl, readResponseLimited, 10000, fetchImpl);
}

const URL0 = 'https://rr2---sn-test.googlevideo.com/videoplayback?expire=1&itag=135&sig=abc';
const buf = new Uint8Array(8192);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// --- Fall 1: Erfolgsfall über Query-Parameter (Verhalten unverändert) ---------
{
  const calls = [];
  const mock = async (u) => {
    calls.push({ url: u });
    return { ok: true, status: 200, headers: new Headers({ 'content-length': '8192' }), arrayBuffer: async () => buf.buffer };
  };
  const r = await makeChunkFn(mock)(URL0, 0, 8191);
  check('1a Status 200 / ok', r.ok === true && r.status === 200);
  check('1b 8192 Bytes', r.bytes && r.bytes.byteLength === 8192);
  check('1c genau 1 Request', calls.length === 1, 'calls=' + calls.length);
  check('1d range-Parameter gesetzt', /[?&]range=0-8191\b/.test(calls[0].url), calls[0].url);
  check('1e kein Range-Header', true);
}

// --- Fall 2: Netzwerkfehler (Status 0) → Wiederholung mit Range-Header -------
{
  const calls = [];
  const mock = async (u, init) => {
    calls.push({ url: u, headers: init && init.headers });
    if (calls.length === 1) throw new TypeError('Failed to fetch');
    return {
      ok: true, status: 206,
      headers: new Headers({ 'content-range': 'bytes 0-8191/14615130', 'content-length': '8192' }),
      arrayBuffer: async () => buf.buffer
    };
  };
  const r = await makeChunkFn(mock)(URL0, 0, 8191);
  check('2a Fallback liefert 206', r.ok === true && r.status === 206);
  check('2b genau 2 Requests', calls.length === 2, 'calls=' + calls.length);
  check('2c 2. Request ohne range-Parameter', !/[?&]range=/.test(calls[1].url), calls[1].url);
  check('2d 2. Request mit Range-Header', calls[1].headers && calls[1].headers.Range === 'bytes=0-8191', JSON.stringify(calls[1].headers));
  check('2e ratebypass erhalten', /ratebypass=yes/.test(calls[1].url));
}

// --- Fall 3: beide Strategien scheitern → Status 0, kein Endlos-Retry -------
{
  const calls = [];
  const mock = async (u) => { calls.push({ url: u }); throw new TypeError('Failed to fetch'); };
  const r = await makeChunkFn(mock)(URL0, 0, 8191);
  check('3a Status 0 / nicht ok', r.ok === false && r.status === 0);
  check('3b genau 2 Requests (kein Endlos-Retry)', calls.length === 2, 'calls=' + calls.length);
}

// --- Fall 4: Abbruch vor dem Start → kein Request ---------------------------
{
  const calls = [];
  const mock = async (u) => { calls.push({ url: u }); return { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => buf.buffer }; };
  const ctrl = new AbortController(); ctrl.abort();
  const r = await makeChunkFn(mock)(URL0, 0, 8191, ctrl.signal);
  check('4a aborted gemeldet', r.ok === false && r.aborted === true);
  check('4b kein Request', calls.length === 0, 'calls=' + calls.length);
}

// --- Fall 5: unmittelbarer Netzwerkfehler im Header-Versuch → Status 0 ------
{
  const calls = [];
  const mock = async (u, init) => {
    calls.push({ url: u, headers: init && init.headers });
    throw new TypeError('Failed to fetch');
  };
  const r = await makeChunkFn(mock)(URL0, 4194304, 4194304 + 8191);
  check('5a Status 0 nach 2 Versuchen', r.ok === false && r.status === 0 && calls.length === 2);
  check('5b 1. Versuch mit Offset-Range', /[?&]range=4194304-4202495\b/.test(calls[0].url), calls[0].url);
}

console.log('\n' + (fail === 0 ? 'PASS' : 'FAIL') + ': ' + pass + ' ok, ' + fail + ' fehlgeschlagen');
process.exit(fail === 0 ? 0 : 1);
