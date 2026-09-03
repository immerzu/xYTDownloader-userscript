// ==UserScript==
// @name         xYTDownloader
// @name:de      xYTDownloader
// @namespace    local:xyt-downloader
// @version      1.0.84
// @description YouTube-Downloader mit einem Klick. Bis 4K mit Ton. /watch, /shorts, /live. Keine externen APIs, direkter VISIONOS-Client, DASH-Merging. / One-click YouTube downloader. Up to 4K with audio. /watch, /shorts, /live. No external APIs, direct VISIONOS client, DASH merging. / Скачивание YouTube в один клик. До 4K со звуком. /watch, /shorts, /live. Без внешних API, прямой VISIONOS, объединение DASH.
// @description:de YouTube-Downloader-Userscript mit einem Klick. Unterstützt alle Qualitäten bis 4K mit Ton. Funktioniert auf /watch, /shorts und /live. Keine externen APIs, direkter VISIONOS-Client. DASH-Merging für hohe Auflösungen mit Ton.
// @author       Ede
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://*.youtube.com/*
// @match        *://www.youtube.com/shorts/*
// @match        *://youtube.com/shorts/*
// @match        *://*.youtube.com/shorts/*
// @exclude      *://music.youtube.com/*
// @grant        GM_download
// @grant        GM_addStyle
// @connect      googlevideo.com
// @connect      *.googlevideo.com
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

/* ============================================================================
 * xYTDownloader — Installation Guide
 * ----------------------------------------------------------------------------
 * 1. Install Tampermonkey (https://www.tampermonkey.net/) in your browser.
 * 2. Open the Tampermonkey dashboard → “Utilities” tab.
 * 3. Drag & drop this file into the “Import from file” field
 *    (or copy the code → “Create a new script” → paste → save).
 * 4. Open a YouTube video: a small “Download” button appears (bottom-right
 *    of the player as an overlay, or in the action bar on /watch pages).
 *    Click it → pick a quality → the file is saved to your download folder.
 *
 * Supported URLs:
 * - https://www.youtube.com/watch?v=<id>   (regular videos)
 * - https://www.youtube.com/shorts/<id>    (Shorts, incl. scroll navigation)
 *
 * How it works:
 * - The script talks directly to YouTube’s Innertube API using the
 *   VISIONOS client. No external
 *   download API, no server-side processing, no API keys.
 * - Progressive formats (video+audio in one file) are downloaded as-is.
 * - Higher resolutions on YouTube are DASH streams (separate video and
 *   audio). The script merges them client-side into ONE MP4 with sound
 *   using a library-free fMP4 box merger (no ffmpeg required).
 *
 * Known limitations:
 * - YouTube usually provides only ~360p as a true progressive format via
 *   ANDROID_VR. Everything above that is DASH video-only and gets merged
 *   automatically with the best MP4 audio track (itag 140 preferred).
 * - WEBM/Opus audio is not supported for merging (MP4 container only);
 *   the script picks MP4/AAC audio automatically.
 * - Age-restricted videos, private videos and livestreams cannot be
 *   downloaded (YouTube rejects the player request — an error is shown).
 * - Short links (youtu.be/...) are not covered (only /watch and /shorts).
 * ==========================================================================*/

(function () {
  'use strict';

  // =========================================================================
  // NOTFALL-LOGS — MÜSSEN IN JEDEM FALL ERSCHEINEN (vor jeder anderen Logik).
  // Wenn Ede KEINE dieser Zeilen sieht, läuft das Script in Tampermonkey gar
  // nicht (Metablock-Problem, falsche Domain, deaktiviert).
  // =========================================================================
  const MY_VERSION = '1.0.84';
  console.log('[xYT] Script geladen v' + MY_VERSION);
  console.log('[xYT] URL:', window.location.href);
  console.log('[xYT] Instanz-Flag:', window.__xytDownloaderInstalled__);

  // -------------------------------------------------------------------------
  // Zentrale Debug-Funktion (v1.0.42): Alle Diagnose-Logs laufen über dbg().
  // Standardmäßig AN (Ede's Konsole zeigt weiterhin alle [xYT]-Diagnosen).
  // Abschaltbar ohne Umbau: localStorage.setItem('xytDebug', '0') + Reload.
  // Die drei NOTFALL-LOGS oben bleiben bewusst console.log direkt (müssen
  // IMMER erscheinen, auch wenn dbg() abgeschaltet ist).
  // -------------------------------------------------------------------------
  const DEBUG = function () {
    try { return String(localStorage.getItem('xytDebug')) !== '0'; } catch (e) { return true; }
  }();
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, arguments); } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Einzel-Instanz-Schutz (versioniert):
  // Nur beenden, wenn eine ANDERE Instanz DERSELBEN Version nachweislich einen
  // Button ins DOM gehängt hat. Ein Flag von einer ALTEN Version (z. B. '1.0.16'
  // oder ein boolesches true) blockt die neue Version NICHT mehr — sie übernimmt
  // und entfernt ggf. einen verwaisten alten Button.
  // -------------------------------------------------------------------------
  try {
    const prevFlag = window.__xytDownloaderInstalled__;
    const existingBtn = document.getElementById('xyt-dl-btn');
    if (prevFlag === MY_VERSION && existingBtn && existingBtn.isConnected) {
      // Andere Instanz DERSELBEN Version läuft und hat den Button gebaut → beenden.
      dbg('[xYT] Doppelte Instanz (v' + MY_VERSION + ') erkannt — beende Duplikat.');
      return;
    }
    // Verwaisten Button einer alten Version entfernen, damit er nicht kollidiert.
    if (existingBtn && existingBtn.isConnected) {
      dbg('[xYT] Entferne Button einer alten Instanz (Flag=' + String(prevFlag) + ').');
      existingBtn.remove();
    }
    // Übernehmen: Flag mit eigener Version setzen.
    try {
      Object.defineProperty(window, '__xytDownloaderInstalled__', { value: MY_VERSION, configurable: true });
    } catch (e2) {
      window.__xytDownloaderInstalled__ = MY_VERSION;
    }
  } catch (e1) {
    window.__xytDownloaderInstalled__ = MY_VERSION;
  }

  // -------------------------------------------------------------------------
  // Sichtbare Fehleranzeige (Diagnose): statt still zu scheitern wird ein
  // JS-Fehler als Overlay gezeigt, damit der Nutzer die Meldung ablesen kann.
  // -------------------------------------------------------------------------
  function showError(msg) {
    try {
      console.error('[xYT]', msg);
      let errBox = document.getElementById('xyt-dl-error');
      if (!errBox) {
        errBox = document.createElement('div');
        errBox.id = 'xyt-dl-error';
        errBox.style.cssText = 'position:fixed;top:8px;right:8px;z-index:100000;max-width:420px;background:#7f1d1d;color:#fff;padding:10px 14px;border-radius:8px;font:12px/1.5 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);white-space:pre-wrap;';
        errBox.addEventListener('click', function () { errBox.remove(); });
        document.body.appendChild(errBox);
      }
      errBox.textContent = 'xYT-Downloader Fehler: ' + msg + '\n(Klick = schließen)';
    } catch (e2) { /* ignore */ }
  }
  window.addEventListener('error', function (ev) {
    // Nur Fehler anzeigen, die aus unserem Script stammen — YouTube-eigene
    // Fehler (uncaught exceptions der Seite) sollen nicht aufploppen.
    const stack = ((ev && (ev.error && ev.error.stack)) || (ev && ev.message) || '') + '';
    if (/xyt-downloader|__xytDownloaderInstalled__|onBtnClick|xyt-dl/i.test(stack)) {
      showError((ev && ev.message) ? ev.message : 'unbekannter Fehler');
    }
  });

  // -------------------------------------------------------------------------
  // Innertube-Client (liefert direkte, signierte googlevideo-Stream-URLs)
  // Liefert direkte, signierte googlevideo-Stream-URLs mit exakter contentLength
  // (ohne POT-Token, ohne 403 — im Gegensatz zum WEB-Client).
  // -------------------------------------------------------------------------
  const YT_PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  // v1.0.72: VISIONOS-Client (am Live-Download-Verhalten verifiziert).
  // Er liefert Streams via `&range=`-URL-Parameter problemlos — unser bisheriger
  // ANDROID_VR-Client lieferte URLs, bei denen YouTube Range-Requests mit 403
  // abwies. VISIONOS liefert `c=VISIONOS`-Stream-URLs, die Range nativ erlauben.
  const ANDROID_VR_CONFIG = {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    androidSdkVersion: 32,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    hl: 'en',
    timeZone: 'UTC',
    utcOffsetMinutes: 0
  };

  // Qualitätsstufen (Höhe -> API-Formatwert). Reihenfolge = Anzeige.
  const VIDEO_QUALITIES = [
    // v1.0.42: NICHT MEHR GENUTZT — war die Qualitätsliste des alten Panels
    // (≤v1.0.39, savenow/dubs.io-Ära). Seit v1.0.40 kommen die Auflösungen
    // aus den echten ANDROID_VR-Streams (extractStreams → video). Auskom-
    // mentiert statt gelöscht (Arbeitsauftrag: ungenutzten Code markieren).
    /*
    { h: 4320, label: '4320p (8K)', api: '8k' },
    { h: 2160, label: '2160p (4K)', api: '4k' },
    { h: 1440, label: '1440p (2K)', api: '1440' },
    { h: 1080, label: '1080p (Full HD)', api: '1080' },
    { h: 720, label: '720p (HD)', api: '720' },
    { h: 480, label: '480p', api: '480' },
    { h: 360, label: '360p', api: '360' },
    { h: 240, label: '240p', api: '240' },
    { h: 144, label: '144p', api: '144' },
    */
  ];
  const AUDIO_FORMATS = [
    // v1.0.42: NICHT MEHR GENUTZT (altes Panel ≤v1.0.39). Auskommentiert
    // statt gelöscht.
    /*
    { api: 'mp3', label: 'MP3 (Standard)' },
    { api: 'm4a', label: 'M4A' },
    { api: 'aac', label: 'AAC' },
    { api: 'opus', label: 'OPUS' },
    { api: 'ogg', label: 'OGG' },
    { api: 'flac', label: 'FLAC (UHQ)' },
    { api: 'wav', label: 'WAV (UHQ)' },
    { api: 'webm', label: 'WEBM (UHQ)' },
    */
  ];

  // -------------------------------------------------------------------------
  // Kleine Helfer
  // -------------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getVideoId() {
    // v1.0.41: Shorts-URLs (/shorts/<videoId>) haben KEINEN ?v=-Parameter —
    // die ID steckt im Pfad. Zuerst ?v= prüfen, dann /shorts/-Pfad, dann
    // /live/-Pfad (beendete Livestreams, v1.0.70), dann PlayerResponse.
    try {
      const p = new URLSearchParams(window.location.search);
      const v = p.get('v');
      if (v) return v;
    } catch (e) { /* ignore */ }
    try {
      const m = window.location.pathname.match(/^\/shorts\/([^\/?&]+)/);
      if (m && m[1]) return m[1];
    } catch (e) { /* ignore */ }
    try {
      const m = window.location.pathname.match(/^\/live\/([^\/?&]+)/);
      if (m && m[1]) return m[1];
    } catch (e) { /* ignore */ }
    try {
      const pr = getPlayerResponse();
      if (pr && pr.videoDetails && pr.videoDetails.videoId) return pr.videoDetails.videoId;
    } catch (e) { /* ignore */ }
    return null;
  }

  function getPlayerResponse() {
    // 1) window-Variable (auf modernen Seiten oft vorhanden)
    try {
      if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.videoDetails) {
        return window.ytInitialPlayerResponse;
      }
    } catch (e) { /* ignore */ }
    // 2) <script>-Tag mit "var ytInitialPlayerResponse = {...};"
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const t = s.textContent || '';
        const m = t.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:var\s+|<\/script>)/s);
        if (m) {
          try { return JSON.parse(m[1]); } catch (e) { /* weiter */ }
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // Tatsächlich verfügbare Höhen aus adaptiveFormats (höchste Auflösung je Stufe),
  // damit die Liste dem entspricht, was für dieses Video existiert.
  // v1.0.42: NICHT MEHR GENUTZT (war für das alte Panel ≤v1.0.39; seit v1.0.40
  // liefert extractStreams die flache Liste direkt aus den Streams). Auskom-
  // mentiert statt gelöscht (Arbeitsauftrag: ungenutzten Code markieren).
  /* === AUSKOMMENTIERT v1.0.42 (ungenutzt) ===
  function getAvailableHeights() {
    const heights = new Set();
    try {
      const pr = getPlayerResponse();
      const sd = pr && pr.streamingData;
      const all = []
        .concat(Array.isArray(sd.formats) ? sd.formats : [])
        .concat(Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : []);
      for (const f of all) {
        if (f && Number.isFinite(f.height) && f.height > 0) heights.add(f.height);
      }
    } catch (e) { }
    return heights;
  }
  === ENDE AUSKOMMENTIERT v1.0.42 === */

  function getVideoTitle() {
    // v1.0.45: Bei Shorts wird ytInitialPlayerResponse beim Scrollen NICHT
    // aktualisiert (bleibt auf dem ERSTEN Short stehen) → der Dateiname hätte
    // immer den Titel des ersten Shorts. document.title wird von YouTube bei
    // jedem Shorts-Wechsel neu gesetzt — deshalb auf /shorts zuerst dort lesen.
    try {
      if (/\/shorts\//.test(window.location.pathname)) {
        const dt = document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
        if (dt && dt !== 'YouTube' && dt !== 'Shorts') return dt;
      }
    } catch (e) { /* ignore */ }
    try {
      const pr = getPlayerResponse();
      const t = pr && pr.videoDetails && pr.videoDetails.title;
      if (t) return String(t);
    } catch (e) { /* ignore */ }
    try {
      const t = $('ytd-watch-metadata h1 yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string');
      if (t && t.textContent) return t.textContent.trim();
    } catch (e) { /* ignore */ }
    return document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'youtube-video';
  }

  // Dateinamens-tauglich machen: unerlaubte Zeichen ersetzen, kürzen.
  function sanitizeFilename(name) {
    return String(name)
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'youtube-video';
  }

  // Schließt das Panel nach kurzer Verzögerung automatisch (nach erfolgreichem Download).
  function autoClosePanelAfter(delayMs) {
    setTimeout(function () {
      try {
        const p = document.getElementById('xyt-dl-panel');
        if (p) p.style.display = 'none';
      } catch (e) { /* ignore */ }
    }, delayMs);
  }

  // Statusanzeige im Panel aktualisieren (gemeinsamer Helfer)
  // v1.0.42: panelStatusEl/panelBarEl/panelFillEl werden beim Panel-Aufbau
  // gecacht (renderPanel* / runDownload) — kein querySelector je Fortschritts-
  // Update (spart Reflow bei jedem Chunk). Fallback: querySelector, falls das
  // Panel zwischenzeitlich neu gebaut wurde (Cache veraltet).
  let panelStatusEl = null, panelBarEl = null, panelFillEl = null;
  function refreshPanelRefs() {
    try {
      panelStatusEl = panel.querySelector('.xyt-dl-status');
      panelBarEl = panel.querySelector('.xyt-dl-bar');
      panelFillEl = panel.querySelector('.xyt-dl-fill');
    } catch (e) { /* ignore */ }
  }
  function setStatusText(text) {
    try {
      let st = panelStatusEl && panelStatusEl.isConnected ? panelStatusEl : (panelStatusEl = document.querySelector('#xyt-dl-panel .xyt-dl-status'));
      if (st) st.textContent = text;
    } catch (e) { /* ignore */ }
  }
  function setBarProgress(pct) {
    try {
      let bar = panelBarEl && panelBarEl.isConnected ? panelBarEl : (panelBarEl = document.querySelector('#xyt-dl-panel .xyt-dl-bar'));
      let fill = panelFillEl && panelFillEl.isConnected ? panelFillEl : (panelFillEl = document.querySelector('#xyt-dl-panel .xyt-dl-fill'));
      if (bar) bar.classList.remove('indet');
      if (fill) {
        // NUR Breite setzen — kein margin-left, keine Animation, keine Transition.
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        fill.style.display = ''; // nie versteckt lassen
      }
      dbg('[xYT] setBarProgress(' + pct + ') → width=' + (fill ? fill.style.width : 'n/a'));
    } catch (e) { console.warn('[xYT] setBarProgress Fehler:', e); }
  }

  // Blob via ObjectURL + <a download> speichern (Dateiname = Titel + Qualität)
  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(objectUrl); a.remove(); } catch (e) { /* ignore */ }
    }, 4000);
  }

  // -------------------------------------------------------------------------
  // Download per manuellem Chunking (Range-Requests).
  // Grund: GM_xmlhttpRequest.onprogress mit arraybuffer feuert in Yandex/
  // Tampermonkey NICHT inkrementell (ein einziger Event mit fast komplettem
  // loaded → „2935.9 MB geladen" sofort, Balken springt). Stattdessen laden wir
  // die Datei in ~4-MB-Stücken per Range-Header und zählen die empfangenen
  // Bytes selbst — der Fortschritt wächst damit garantiert inkrementell.
  // -------------------------------------------------------------------------
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB je Chunk

  // v1.0.71: Browser-Header, die YouTube für googlevideo.com-Range-Anfragen
  // voraussetzt. Ohne diese Header antwortet YouTube mit 403 Forbidden
  // (leere Chunk-Antwort). GM_xmlhttpRequest ergänzt KEINEN Referer
  // automatisch — wir müssen ihn explizit setzen.
  const VIDEO_REQUEST_HEADERS = {
    'Origin': 'https://www.youtube.com',
    'Referer': 'https://www.youtube.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Sec-CH-UA': '"Not/A)Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-CH-UA-Bitness': '"64"',
    'Sec-CH-UA-Arch': '"x86"',
    'Sec-CH-UA-Wow64': '?0',
    'Sec-CH-UA-Platform-Version': '"19.0.0"',
    'Accept': '*/*',
    'Accept-Language': 'de,en;q=0.9'
  };

  // Header-Builder: Range-Header (vom Aufrufer gesetzt) überschreibt nicht,
  // aber alle anderen Browser-Header werden ergänzt, wenn fehlend.
  function buildVideoHeaders(extra) {
    const h = Object.assign({}, VIDEO_REQUEST_HEADERS);
    if (extra) {
      for (const k in extra) {
        if (extra.hasOwnProperty(k)) h[k] = extra[k];
      }
    }
    return h;
  }

  // v1.0.72: Range-Chunk per native window.fetch laden. Die Range wird als
  // `&range=START-END` DIREKT in die Stream-URL geschrieben — so lädt der
  // Stream Audio itag 140 und Video itag 401 komplett per `&range=` +
  // `&ratebypass=yes`. Zusätzlich werden der `Referer`-Header auf die
  // googlevideo-URL selbst, ein Desktop-UA
  // und `Accept-Encoding: identity` gesetzt — das komplettiert das funktionie-
  // rende Request-Set. Liefert {status, bytes, ok, headers}.
  function fetchRangeChunk(url, start, end) {
    let u = String(url);
    if (!/range=/i.test(u)) {
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'range=' + start + '-' + end;
    }
    if (!/ratebypass=/i.test(u)) {
      u += '&ratebypass=yes';
    }
    // Referer auf die googlevideo-URL selbst; UA/Firefox-Desktop;
    // kein Accept-Encoding (identisch), damit die Rohbytes nicht dekomprimiert werden.
    const host = u.split('?')[0];
    return fetch(u, {
      headers: {
        'Referer': host,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64; rv:76.0) Gecko/20100101 Firefox/76.0',
        'Accept-Encoding': 'identity'
      }
    }).then(function (res) {
      if (!res.ok) return { status: res.status, bytes: null, ok: false, headers: res.headers };
      return res.arrayBuffer().then(function (ab) {
        return { status: res.status, bytes: ab, ok: true, headers: res.headers };
      });
    }).catch(function (err) {
      return { status: 0, bytes: null, ok: false, err: err, headers: null };
    });
  }

  function downloadUrl(url, filename, expectedSize) {
    let knownTotal = Number(expectedSize) || 0;   // v1.0.38: let, damit die Probe die Größe nachtragen kann
    const chunks = [];
    let received = 0;
    let probed = false; // v1.0.38: nur EINE Größen-Probe pro Download

    function reportProgress() {
      if (knownTotal > 0) {
        const pct = Math.max(0, Math.min(100, Math.round((received / knownTotal) * 100)));
        setBarProgress(pct);
        setStatusText('Download läuft: ' + pct + ' % (' + (received / 1048576).toFixed(1) + ' / ' + (knownTotal / 1048576).toFixed(1) + ' MB)');
        dbg('[xYT] Chunk-Fortschritt: received=' + received + ' total=' + knownTotal + ' → pct=' + pct);
      } else {
        // v1.0.38: Auch ohne bekannte Gesamtgröße den Balken sichtbar machen —
        // statisch wachsend anhand der bereits geladenen Bytes (kein %-Sprung,
        // kein Sweep). FinishDownload setzt später 100 %.
        setBarProgress(Math.min(99, Math.max(5, Math.round((received / Math.max(received + CHUNK_SIZE, 1)) * 100))));
        setStatusText('Download läuft: ' + (received / 1048576).toFixed(1) + ' MB geladen …');
        dbg('[xYT] Chunk-Fortschritt: received=' + received + ' (total unbekannt)');
      }
    }

    // v1.0.38: Bei unbekannter Größe (progressive Formate liefern in der
    // ANDROID_VR-Antwort kein contentLength) einmalig die Dateigröße per
    // Range-Probe (bytes=0-0) ermitteln — wie in v1.0.12–v1.0.15. Der
    // Content-Range-Header liefert die Gesamtgröße → Balken 0–100 % wie beim
    // DASH/Merge-Pfad. Schlägt die Probe fehl, läuft der alte Pfad weiter
    // (Balken wächst statisch, s. reportProgress-else).
    function probeSize() {
      if (probed || knownTotal > 0) { nextChunk(0); return; }
      probed = true;
      // v1.0.71: native fetch (konsistent mit den Chunks; kein 403 in der Sandbox).
      fetchRangeChunk(url, 0, 0).then(function (r) {
        try {
          const cr = String(r.headers && r.headers.get && (r.headers.get('content-range') || '') || '');
          const m = cr.match(/bytes\s+0-0\/(\d+)/i);
          if (r.status === 206) {
            knownTotal = Number(r.bytes ? r.bytes.byteLength : 1) + 0;
            const m2 = cr.match(/\/\s*(\d+)/i);
            if (m2 && Number(m2[1]) > 0) {
              knownTotal = Number(m2[1]);
              dbg('[xYT] DL-PROBE: Content-Range → Gesamtgröße ' + knownTotal + ' B');
              nextChunk(0);
              return;
            }
          }
          // Status 206, aber kein Content-Range → bekannte Größe nutzen wenn vorhanden
          if (r.status === 206 && r.bytes && r.bytes.byteLength > 0) {
            chunks.push(r.bytes);
            received = r.bytes.byteLength;
          }
          console.warn('[xYT] DL-PROBE: keine Größe ermittelbar (Status ' + r.status + ') — Fortschritt ohne %');
          nextChunk(received);
        } catch (e2) {
          console.warn('[xYT] DL-PROBE-Fehler:', e2);
          nextChunk(received);
        }
      });
    }

    function nextChunk(start) {
      // Ende erreicht, wenn wir alle bekannten Bytes haben (oder bei unbekannter
      // Größe ein Chunk kleiner als CHUNK_SIZE zurückkam → letzter Chunk).
      const end = knownTotal > 0
        ? Math.min(start + CHUNK_SIZE - 1, knownTotal - 1)
        : (start + CHUNK_SIZE - 1);
      if (knownTotal > 0 && start >= knownTotal) {
        finishDownload();
        return;
      }
      // DIAGNOSE: Jede Chunk-Anfrage mit exakter Range protokollieren
      dbg('[xYT] DL-CHUNK-REQ: Range=bytes ' + start + '-' + end + ' (erwartete Chunk-Größe max ' + CHUNK_SIZE + ' B, knownTotal=' + knownTotal + ')');
      // v1.0.71: native fetch statt GM_xmlhttpRequest (siehe fetchRangeChunk-Kommentar).
      fetchRangeChunk(url, start, end).then(function (r) {
        if (!r.ok || !r.bytes) {
          throw new Error('leere Chunk-Antwort (Status ' + r.status + ')');
        }
        const buf = r.bytes;
        const prev = received;
        chunks.push(buf);
        received += buf.byteLength;
        // DIAGNOSE: Was kam real zurück? Status 206 = Range ok, 200 = kompletter Body!
        dbg('[xYT] DL-CHUNK-OK: Status=' + r.status + ' | angefordert=' + (end - start + 1) + ' B | erhalten=' + buf.byteLength + ' B | received-gesamt=' + received);
        if (r.status === 200 && knownTotal > 0 && buf.byteLength >= knownTotal) {
          // Server hat Range ignoriert und die KOMPLETTE Datei geliefert → fertig.
          console.warn('[xYT] DL-CHUNK-WARNUNG: Status 200 (kompletter Body) statt 206 — Range ignoriert.');
          finishDownload();
          return;
        }
        reportProgress();
        if (knownTotal > 0) {
          nextChunk(prev + buf.byteLength);
        } else if (buf.byteLength < CHUNK_SIZE) {
          finishDownload();
        } else {
          nextChunk(prev + buf.byteLength);
        }
      }).catch(function (e3) {
        console.warn('[xYT] Chunk-Fehler, Fallback GM_download:', e3);
        fallbackDownload(url, filename);
      });
    }

    function finishDownload() {
      try {
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        setBarProgress(100);
        setStatusText('Download abgeschlossen: ' + filename);
        dbg('[xYT] DL-FERTIG: byteLength=' + blob.size + ' expectedSize=' + knownTotal + ' | Chunks=' + chunks.length);
        if (knownTotal > 0) {
          const dev = Math.abs(blob.size - knownTotal) / knownTotal;
          dbg('[xYT] Größencheck: erwartet=' + knownTotal + ' B, tatsächlich=' + blob.size + ' B, Abweichung=' + (dev * 100).toFixed(2) + ' %');
        }
        saveBlob(blob, filename);
        autoClosePanelAfter(2500);
      } catch (e4) {
        console.warn('[xYT] Zusammenfügen fehlgeschlagen, Fallback GM_download:', e4);
        fallbackDownload(url, filename);
      }
    }

    // v1.0.38: Bei unbekannter Größe erst proben, dann Chunks; sonst direkt.
    if (knownTotal > 0) {
      nextChunk(0);
    } else {
      probeSize();
    }
    return true;
  }


  // Fallback: GM_download (falls Blob nicht klappt), zuletzt window.open
  function fallbackDownload(url, filename) {
    if (typeof GM_download === 'function') {
      try {
        GM_download({
          url: String(url),
          name: filename,
          saveAs: false,
          onload: function () {
            setBarProgress(100);
            setStatusText('Download abgeschlossen: ' + filename);
            autoClosePanelAfter(2500);
          },
          onerror: function (err) {
            setStatusText('Download fehlgeschlagen: ' + ((err && err.error) || 'unbekannter Fehler'));
          }
        });
        return;
      } catch (e) {
        console.warn('[xYT] GM_download fehlgeschlagen, Fallback window.open:', e);
      }
    }
    try {
      window.open(url);
      autoClosePanelAfter(2500);
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // Chunked-Download, der die Bytes zurückgibt (für den DASH-Merge-Pfad).
  // Gleiche Range-Chunking-Methode wie downloadUrl, aber Promise-basiert:
  // liefert am Ende ein Uint8Array, das an mergeFmp4 übergeben werden kann.
  // onProgress(received, knownTotal) wird bei jedem Chunk aufgerufen.
  // v1.0.72: `refreshInfo` = {itag, videoId}. Fällt ein Chunk mit 403 aus,
  // wird automatisch eine FRISCHE Player-Response geholt (neue signierte URL
  // für denselben itag) und ab der letzten Byte-Position fortgesetzt — die
  // Strategie gegen YouTube-URL-Limits.
  // -------------------------------------------------------------------------
  function downloadStreamBytes(url, expectedSize, onProgress, refreshInfo, initRange) {
    return new Promise(function (resolve, reject) {
      const knownTotal = Number(expectedSize) || 0;
      const chunks = [];
      let received = 0;
      // init-Segment (ftyp+moov bei segmentierten AV1/VP9-Streams) separat laden
      let initLoaded = false;
      const initBytes = [];
      let initDone = false;
      // v1.0.72: max. 3 Frisch-URL-Retries, damit ein hartnäckiger 403 nicht
      // in einer Endlosschleife endet.
      let urlTries = 0;
      const MAX_URL_TRIES = 3;
      // aktuelle URL (wird nach einem 403 durch die frische ersetzt)
      let currentUrl = String(url);

      // v1.0.73: init-Segment (Bytes initStart..initEnd) zuerst laden. Es muss
      // VOR den Medien-Daten im resultierenden Byte-Strom stehen, damit
      // mergeFmp4 die ftyp/moov findet. Nur bei segmentierten Codecs
      // (AV1/VP9) nötig — bei H.264 liegen ftyp+moov bereits am Dateianfang
      // und würden sonst doppelt geladen.
      const isSegmentedCodec = initRange && initRange.codec && (/av01|vp9|avc3/i.test(String(initRange.codec)));
      // v1.0.74: init-Segment umfasst ftyp+moov, das bei YouTube bis
      // indexRange.end reicht (nicht nur initRange.end). Der moov-Body liegt
      // im indexRange-Teil. Also 0..indexEnd laden.
      function initEndOffset() {
        return (initRange && initRange.indexEnd >= 0) ? Number(initRange.indexEnd) : (initRange ? Number(initRange.initEnd) : -1);
      }
      function needsInit() {
        return isSegmentedCodec && initEndOffset() >= 0;
      }
      function loadInit() {
        if (initDone || !needsInit()) {
          initDone = true; initLoaded = true;
          nextChunk(0);
          return;
        }
        const start = 0;
        const end = initEndOffset();
        fetchRangeChunk(currentUrl, start, end).then(function (r) {
          if (!r.ok || !r.bytes) {
            console.warn('[xYT] init-Segment fehlgeschlagen (Status ' + r.status + ') — setze ohne init fort.');
            initDone = true; initLoaded = true;
            nextChunk(mediaStartOffset());
            return;
          }
          initBytes.push(r.bytes);
          initDone = true; initLoaded = true;
          received += r.bytes.byteLength;
          dbg('[xYT] INIT-SEGMENT geladen: ' + r.bytes.byteLength + ' B (Bytes ' + start + '-' + end + ')');
          nextChunk(mediaStartOffset());
        });
      }

      function refreshUrl() {
        if (!refreshInfo || !refreshInfo.videoId || !refreshInfo.itag || urlTries >= MAX_URL_TRIES) {
          return Promise.resolve(null);
        }
        urlTries++;
        dbg('[xYT] 403 → hole FRISCHE URL (Versuch ' + urlTries + '/' + MAX_URL_TRIES + ', itag ' + refreshInfo.itag + ') ab Byte ' + received);
        return fetchAndroidVrPlayer(refreshInfo.videoId).then(function (pr) {
          const streams = extractStreams(pr);
          // passenden Stream finden (für Audio- oder Video-Downstream)
          const mine = (refreshInfo.kind === 'audio')
            ? streams.audioOnly.find(function (s) { return s.itag === refreshInfo.itag; })
            : streams.video.find(function (s) { return s.itag === refreshInfo.itag; });
          if (mine && mine.url) {
            currentUrl = String(mine.url);
            dbg('[xYT] FRISCHE URL erhalten — setze ab Byte ' + received + ' fort.');
            return true;
          }
          return null;
        }).catch(function () { return null; });
      }

      // v1.0.73: Start-Offset der Mediendaten. Bei segmentierten Streams
      // (initRange vorhanden) beginnt der Media-Byte-Strom bei initEnd+1
      // (das init-Segment - ftyp+moov - wurde separat in loadInit geladen
      // und wird in finishOk vorangestellt).
      function mediaStartOffset() {
        if (needsInit()) return initEndOffset() + 1;
        return 0;
      }

      function nextChunk(start) {
        const end = knownTotal > 0
          ? Math.min(start + CHUNK_SIZE - 1, knownTotal - 1)
          : (start + CHUNK_SIZE - 1);
        if (knownTotal > 0 && start >= knownTotal) {
          finishOk();
          return;
        }
        fetchRangeChunk(currentUrl, start, end).then(function (r) {
          // v1.0.72: 403 → frische URL holen und ab `start` nochmal versuchen.
          if (!r.ok || !r.bytes) {
            if (r.status === 403 || r.status === 416) {
              return refreshUrl().then(function (ok) {
                if (ok) { nextChunk(start); return; }
                throw new Error('leere Chunk-Antwort (Status ' + r.status + ')');
              });
            }
            throw new Error('leere Chunk-Antwort (Status ' + r.status + ')');
          }
          const buf = r.bytes;
          const prev = received;
          chunks.push(buf);
          received += buf.byteLength;
          if (r.status === 200 && knownTotal > 0 && buf.byteLength >= knownTotal) {
            finishOk();
            return;
          }
          if (onProgress) onProgress(received, knownTotal);
          if (knownTotal > 0) {
            nextChunk(prev + buf.byteLength);
          } else if (buf.byteLength < CHUNK_SIZE) {
            finishOk();
          } else {
            nextChunk(prev + buf.byteLength);
          }
        }).catch(reject);
      }

      function finishOk() {
        try {
          // init-Segment (ftyp+moov) zuerst, dann die Mediendaten
          const parts = initBytes.slice();
          for (const c of chunks) parts.push(c);
          const total = parts.reduce(function (s, c) { return s + c.byteLength; }, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of parts) {
            out.set(new Uint8Array(c), off);
            off += c.byteLength;
          }
          resolve(out);
        } catch (e4) {
          reject(e4);
        }
      }

      // Start: zuerst init-Segment laden (falls segmentierter Codec), dann Medien
      if (needsInit()) {
        loadInit();
      } else {
        nextChunk(0);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Manuelles fMP4-Box-Merging (bibliotheksfrei — „ffmpeg -c copy" im Browser).
  // Beide YouTube-DASH-Streams sind fMP4: ftyp + moov(mvhd,mvex,trak) + sidx +
  // moof/mdat-Segmente. Der Merge baut EINE moov mit beiden traks (Audio-
  // track_id 1→2), übernimmt beide trex (mvex!), patcht alle Audio-tfhd auf
  // track_id 2 und konkateniert Video-Segmente + Audio-Segmente (sidx raus).
  // Ohne die mvex/trex-Box öffnet Chromium die Datei nicht (DEMUXER_ERROR).
  // -------------------------------------------------------------------------
  function mergeFmp4(videoU8, audioU8) {
    const u32 = (b, o) => ((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0);
    const setU32 = (b, o, val) => { b[o] = (val >>> 24) & 0xFF; b[o + 1] = (val >>> 16) & 0xFF; b[o + 2] = (val >>> 8) & 0xFF; b[o + 3] = val & 0xFF; };
    function topBoxes(b) {
      const res = []; let off = 0;
      while (off + 8 <= b.length) {
        const size = u32(b, off);
        const t = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
        if (size < 8 || off + size > b.length) break;
        res.push({ type: t, start: off, size, end: off + size });
        off += size;
      }
      return res;
    }
    function childBoxes(b, box) {
      const res = []; let off = box.start + 8;
      while (off + 8 <= box.end) {
        const size = u32(b, off);
        const t = String.fromCharCode(b[off + 4], b[off + 5], b[off + 6], b[off + 7]);
        if (size < 8 || off + size > box.end) break;
        res.push({ type: t, start: off, size, end: off + size });
        off += size;
      }
      return res;
    }
    function concat(parts) {
      const total = parts.reduce((s, p) => s + p.length, 0);
      const r = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { r.set(p, o); o += p.length; }
      return r;
    }
    // tfhd rekursiv (moof→traf→tfhd) finden und track_id patchen
    function patchTfhdInSegment(seg, newTrackId) {
      if (seg.length < 8 || String.fromCharCode(seg[4], seg[5], seg[6], seg[7]) !== 'moof') return false;
      const stack = [{ start: 8, end: seg.length }];
      while (stack.length) {
        const { start, end } = stack.pop();
        let off = start;
        while (off + 8 <= end) {
          const size = u32(seg, off);
          const t = String.fromCharCode(seg[off + 4], seg[off + 5], seg[off + 6], seg[off + 7]);
          if (size < 8 || off + size > end) break;
          if (t === 'tfhd') { setU32(seg, off + 12, newTrackId); return true; }
          if (t === 'traf' || t === 'moof') stack.push({ start: off + 8, end: off + size });
          off += size;
        }
      }
      return false;
    }

    const vBoxes = topBoxes(videoU8);
    const aBoxes = topBoxes(audioU8);
    const vFtyp = vBoxes.find(x => x.type === 'ftyp');
    const vMoov = vBoxes.find(x => x.type === 'moov');
    const aMoov = aBoxes.find(x => x.type === 'moov');
    if (!vFtyp || !vMoov || !aMoov) throw new Error('ftyp/moov fehlt');
    const vKids = childBoxes(videoU8, vMoov);
    const aKids = childBoxes(audioU8, aMoov);
    const mvhd = vKids.find(x => x.type === 'mvhd');
    const vTrak = vKids.find(x => x.type === 'trak');
    const vMvex = vKids.find(x => x.type === 'mvex');
    const aTrak = aKids.find(x => x.type === 'trak');
    const aMvex = aKids.find(x => x.type === 'mvex');
    if (!mvhd || !vTrak || !vMvex || !aTrak || !aMvex) throw new Error('moov-Bestandteil fehlt');

    // mvhd: next_track_ID → 3 (letztes Feld)
    const mvhdCopy = videoU8.slice(mvhd.start, mvhd.end);
    setU32(mvhdCopy, mvhdCopy.length - 4, 3);

    // Video-trak (track 1 bleibt)
    const vTrakCopy = videoU8.slice(vTrak.start, vTrak.end);

    // Audio-trak: tkhd track_id 1→2
    const aTrakCopy = audioU8.slice(aTrak.start, aTrak.end);
    const aTkhd = childBoxes(aTrakCopy, { start: 0, size: aTrakCopy.length, end: aTrakCopy.length }).find(x => x.type === 'tkhd');
    if (!aTkhd) throw new Error('audio-tkhd fehlt');
    const aVer = aTrakCopy[aTkhd.start + 8];
    setU32(aTrakCopy, aTkhd.start + 16 + (aVer === 1 ? 12 : 4), 2);

    // mvex: Video-mvex + Audio-trex (track_id 1→2)
    const vMvexCopy = videoU8.slice(vMvex.start, vMvex.end);
    const aTrex = childBoxes(audioU8, aMvex).find(x => x.type === 'trex');
    if (!aTrex) throw new Error('audio-trex fehlt');
    const aTrexCopy = audioU8.slice(aTrex.start, aTrex.end);
    setU32(aTrexCopy, 12, 2);
    const mvexContent = concat([vMvexCopy.slice(8), aTrexCopy]);
    const mvex = new Uint8Array(8 + mvexContent.length);
    setU32(mvex, 0, 8 + mvexContent.length);
    mvex[4] = 109; mvex[5] = 118; mvex[6] = 101; mvex[7] = 120; // 'mvex'
    mvex.set(mvexContent, 8);

    // moov: mvhd + mvex + video-trak + audio-trak
    const moovContent = concat([mvhdCopy, mvex, vTrakCopy, aTrakCopy]);
    const moov = new Uint8Array(8 + moovContent.length);
    setU32(moov, 0, 8 + moovContent.length);
    moov[4] = 109; moov[5] = 111; moov[6] = 111; moov[7] = 118; // 'moov'
    moov.set(moovContent, 8);

    // Segmente: alles nach moov, sidx raus
    const vSegs = [], aSegs = [];
    for (const box of vBoxes) if (box.start > vMoov.end && box.type !== 'sidx') vSegs.push(videoU8.slice(box.start, box.end));
    for (const box of aBoxes) if (box.start > aMoov.end && box.type !== 'sidx') aSegs.push(audioU8.slice(box.start, box.end));
    for (const seg of aSegs) patchTfhdInSegment(seg, 2);

    return concat([videoU8.slice(vFtyp.start, vFtyp.end), moov, ...vSegs, ...aSegs]);
  }

  // Wählt den besten MP4-Audio-Stream für den Merge (itag 140 AAC bevorzugt).
  // Nur MP4-Audio (mp4a/AAC) passt in den MP4-Container — Opus/WEBM nicht.
  function pickMergeAudio(audioOnly) {
    if (!Array.isArray(audioOnly) || audioOnly.length === 0) return null;
    const mp4 = audioOnly.filter(function (s) { return (s.mime || '').indexOf('audio/mp4') === 0; });
    const pool = mp4.length > 0 ? mp4 : audioOnly;
    // Höchste Bitrate zuerst (extractStreams sortiert schon, hier zusätzlich sichern)
    pool.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
    return pool[0] || null;
  }

  // -------------------------------------------------------------------------
  // Innertube-Client (primärer Pfad)
  // POST /youtubei/v1/player mit den Client-Config-Headern.
  // Antwort enthält direkte signierte
  // googlevideo-Stream-URLs mit exakter contentLength.
  // WICHTIG (v1.0.21): Ohne X-Goog-Visitor-Id + Origin/Referer liefert YouTube
  // LOGIN_REQUIRED. Die Visitor-ID wird aus dem Seitenkontext (ytcfg) gelesen.
  // -------------------------------------------------------------------------
  function getVisitorData() {
    try {
      // ytcfg.data_ ist das Rohobjekt; ytcfg.get() die offizielle API
      if (window.ytcfg && typeof window.ytcfg.get === 'function') {
        const v = window.ytcfg.get('VISITOR_DATA');
        if (v) return v;
      }
      if (window.ytcfg && window.ytcfg.data_ && window.ytcfg.data_.VISITOR_DATA) {
        return window.ytcfg.data_.VISITOR_DATA;
      }
      // Fallback: VISITOR_DATA aus dem Seiten-HTML (var ytcfg ... VISITOR_DATA)
      const m = document.documentElement.innerHTML.match(/VISITOR_DATA["']?\s*:\s*["']([^"']+)["']/);
      if (m) return m[1];
    } catch (e) { /* ignore */ }
    return '';
  }

  // v1.0.84: Authorization-Header aus der SAPISID-Cookie generieren.
  // In Yandex-Browser isoliert Tampermonkey die Addon-World so streng, dass der
  // fetch-Seiten-Kontext die echten YouTube-Session-Cookies NICHT durchreicht
  // (HAR-Beleg: req['cookies']=0 beim Player-Request) — selbst mit
  // credentials:'include'. Ein explizit gesetzter 'Authorization'-Header wird
  // aber IMMER als Request-Header mitgesendet, unabhängig vom Cookie-Transport.
  // YouTube akzeptiert eingeloggte Client-Requests anhand dieses Headers
  // (wie der echte Web-Player: 'SAPISIDHASH <ts>_<sha1(ts sapid ts)>').
  // Verifiziert 2026-09-03 im Playwright: VISIONOS-Request mit Authorization
  // → status OK, adaptive 27.
  function getSapisidAuth() {
    try {
      const m = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/);
      if (!m) return '';
      const sapisid = m[1];
      const ts = Math.floor(Date.now() / 1000);
      return { sapisid: sapisid, ts: ts, payload: ts + ' ' + sapisid + ' ' + ts };
    } catch (e) { return ''; }
  }

  // v1.0.84: Web-Crypto-SHA1 für den SAPISIDHASH (async). Fallback: falls
  // crypto.subtle fehlt, Viele Addon-Welten haben nur TextEncoder — wir lassen
  // den Authorization-Header dann weg (LOGIN_REQUIRED-Risiko bleibt, aber kein
  // Rethrow).
  async function buildSapisidHash() {
    try {
      const info = getSapisidAuth();
      if (!info) return '';
      const enc = new TextEncoder().encode(info.payload);
      if (crypto && crypto.subtle && crypto.subtle.digest) {
        const buf = await crypto.subtle.digest('SHA-1', enc);
        const hx = Array.from(new Uint8Array(buf)).map(function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        return 'SAPISIDHASH ' + info.ts + '_' + hx;
      }
      return '';
    } catch (e) { return ''; }
  }

  // -------------------------------------------------------------------------
  // v1.0.70: Erkennung von Livestreams — diese sind NICHT herunterladbar.
  // Merkmale: isLive===true, isLiveDvrEnabled===true ohne Streams,
  // hlsManifestUrl ohne formats/adaptiveFormats.
  // WICHTIG: NICHT isLiveContent verwenden — auch bei vergangenen VODs true.
  // -------------------------------------------------------------------------
  function isLivePlayerResponse(pr) {
    try {
      const vd = pr && pr.videoDetails;
      const sd = pr && pr.streamingData;
      const hasFormats = Array.isArray(sd && sd.formats) && sd.formats.length > 0;
      const hasAdaptive = Array.isArray(sd && sd.adaptiveFormats) && sd.adaptiveFormats.length > 0;
      if (vd && vd.isLive === true) return true;
      if (vd && vd.isLiveDvrEnabled === true && !hasFormats && !hasAdaptive) return true;
      if (sd && sd.hlsManifestUrl && !hasFormats && !hasAdaptive) return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function fetchAndroidVrPlayer(videoId) {
    return new Promise(function (resolve, reject) {
      // Body: contentPlaybackContext mit html5Preferences +
      // signatureTimestamp statt vis:0
      const body = JSON.stringify({
        context: { client: ANDROID_VR_CONFIG },
        videoId: String(videoId),
        playbackContext: {
          contentPlaybackContext: {
            html5Preferences: 'HTML5_PREF_WANTS',
            signatureTimestamp: 20663
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      });
      const visitor = getVisitorData();
      const headers = {
        'User-Agent': ANDROID_VR_CONFIG.userAgent,
        'X-Youtube-Client-Name': '28',
        'X-Youtube-Client-Version': ANDROID_VR_CONFIG.clientVersion,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/watch?v=' + encodeURIComponent(String(videoId)),
        'Accept-Language': 'de,en-gb;q=0.7,en;q=0.3',
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      };
      if (visitor) {
        headers['X-Goog-Visitor-Id'] = visitor;
        dbg('[xYT] X-Goog-Visitor-Id gesetzt (' + visitor.slice(0, 20) + '…)');
      } else {
        console.warn('[xYT] Keine VISITOR_DATA im Seitenkontext gefunden — LOGIN_REQUIRED-Risiko');
      }
      try {
        // v1.0.84: Authorization (SAPISIDHASH) vorbereiten. Der Hash braucht
        // crypto.subtle (async) — wir berechnen ihn hier und setzen den Header,
        // BEVOR fetch läuft. In Yandex reicht credentials:'include' nicht, weil
        // die Addon-World die Cookies nicht durchreicht; der Authorization-Header
        // wird aber immer mitgesendet und identifiziert die eingeloggte Session.
        buildSapisidHash().then(function (authHeader) {
          if (authHeader) {
            headers['Authorization'] = authHeader;
            dbg('[xYT] Authorization gesetzt (SAPISIDHASH) — Länge ' + authHeader.length);
          } else {
            console.warn('[xYT] Kein SAPISIDHASH (kein SAPISID-Cookie/crypto.subtle) — LOGIN_REQUIRED-Risiko');
          }
          // v1.0.80: Player-Request per Seiten-`fetch` statt GM_xmlhttpRequest.
          // GM_xmlhttpRequest läuft im Tampermonkey-Sandbox-Kontext ohne die
          // Browser-Session → YouTube antwortet mit LOGIN_REQUIRED
          // ("Sign in to confirm you're not a bot"). fetch läuft im Seiten-Kontext
          // mit der echten YouTube-Session und umgeht die Bot-Prüfung (verifiziert
          // 2026-08-28 im Playwright: Seiten-fetch liefert status OK, 25+ Formate).
          //
          // v1.0.83: credentials:'include' ergänzt. In Yandex-Browser isoliert die
          // Tampermonkey-Addon-World den Default (same-origin), sodass die echten
          // YouTube-Session-Cookies NICHT mitgesendet werden → YouTube wertet den
          // Request als anonym/Bot → LOGIN_REQUIRED ("Sign in to confirm... not a bot"),
          // obwohl der Nutzer eingeloggt ist. credentials:'include' erzwingt, dass
          // die Seiten-Cookies (SAPISID etc.) dem Player-Request mitgegeben werden
          // (verifiziert an HAR: req['cookies'] war 0 ohne credentials).
          fetch(YT_PLAYER_ENDPOINT, {
            method: 'POST',
            headers: headers,
            body: body,
            credentials: 'include',
            referrerPolicy: 'unsafe-url'
          }).then(function (res) {
            return res.json();
          }).then(function (j) {
          const status = j && j.playabilityStatus && j.playabilityStatus.status;
          // v1.0.70: Livestream-Statuswerte mit verständlicher Meldung abfangen.
          if (status === 'LIVE_STREAM_OFFLINE' || status === 'LIVE_STREAM_ENDED') {
            reject(new Error('Dieser Livestream ist nicht verfügbar (offline/beendet). Live-Übertragungen können nicht heruntergeladen werden.'));
            return;
          }
          if (status && status !== 'OK') {
            reject(new Error('YouTube-Status: ' + status + (j.playabilityStatus && j.playabilityStatus.reason ? ' — ' + j.playabilityStatus.reason : '')));
            return;
          }
          if (isLivePlayerResponse(j)) {
            reject(new Error('Dieses Video ist ein Livestream und kann nicht heruntergeladen werden.'));
            return;
          }
          if (!j || !j.streamingData) {
            reject(new Error('Keine streamingData in ANDROID_VR-Antwort'));
            return;
          }
          resolve(j);
        }).catch(function (e) {
          reject(new Error('ANDROID_VR-Netzwerk-/Parsefehler: ' + (e && e.message ? e.message : String(e))));
        });
        }).catch(function (e) {
          // buildSapisidHash()-Kette: wenn der Hash nicht berechnet werden kann,
          // gehen wir trotzdem weiter (ohne Authorization-Header) oder rejected.
          // reject(e) nur bei hartem Fehler; sonst still weiter.
          reject(new Error('ANDROID_VR-Vorbereitung fehlgeschlagen: ' + (e && e.message ? e.message : String(e))));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Zuverlässige Erkennung, ob ein Stream Audio enthält — rein anhand der
  // ANDROID_VR-Antwortfelder (keine itag-Liste). Progressive Formate (itag 18/22/37)
  // haben oft KEIN audioChannels-Feld; Audio ist dann nur über audioCodec/
  // audioQuality bzw. den zweiten Codec in mimeType erkennbar.
  //   formats:        video/mp4; codecs="avc1.42001E, mp4a.40.2"  → mp4a = Audio enthalten
  //   adaptive video: video/mp4; codecs="avc1.640028"            → kein Audio-Codec
  //   adaptive audio: audio/mp4; codecs="mp4a.40.2"              → Audio-only
  // DIAGNOSE (nur für die Konsole): WARUM gilt ein Format als „mit Ton“ oder „ohne Ton“?
  // Reine Zusatzfunktion — streamHasAudio() selbst bleibt unverändert. Gibt den
  // ersten ausschlaggebenden Grund als String zurück (gleiche Prüfreihenfolge).
  function audioReason(f) {
    try {
      if (f.audioChannels && f.audioChannels > 0) return 'audioChannels=' + f.audioChannels;
      if (f.audioCodec) return 'audioCodec=' + f.audioCodec;
      if (f.audioQuality && f.audioQuality !== 'NONE') return 'audioQuality=' + f.audioQuality;
      const mime = f.mimeType || '';
      const cm = mime.match(/codecs="([^"]+)"/i);
      if (cm) {
        const codecs = cm[1].split(',').map(function (c) { return c.trim().toLowerCase(); });
        const audioPrefixes = ['mp4a', 'opus', 'ac-3', 'ec-3', 'mp3', 'vorbis', 'flac', 'aac', 'amr'];
        for (const codec of codecs) {
          for (const p of audioPrefixes) {
            if (codec.indexOf(p) === 0) return 'mime-Codec=' + codec;
          }
        }
        return 'mime-Codecs ohne Audio: ' + codecs.join('+');
      }
      return 'kein codecs-Feld im mimeType';
    } catch (e) { return 'Fehler: ' + e.message; }
  }

  function streamHasAudio(f) {
    // v1.0.42: Nutzt audioReason() als EINE Prüfquelle (vorher doppelte Logik
    // in zwei Funktionen). Verhalten identisch: true, wenn audioReason einen
    // Audio-Grund nennt (audioChannels/audioCodec/audioQuality/mime-Codec).
    const reason = audioReason(f);
    if (reason.indexOf('audioChannels=') === 0) return true;
    if (reason.indexOf('audioCodec=') === 0) return true;
    if (reason.indexOf('audioQuality=') === 0) return true;
    if (reason.indexOf('mime-Codec=') === 0) return true;
    return false;
  }

  // Extrahiert aus der playerResponse die nutzbaren Streams, getrennt nach Kategorien:
  //   progressive : aus streamingData.formats MIT Audio-Codec (Video+Audio in EINER Datei) → HAUPTKATEGORIE
  //   videoOnly   : aus streamingData.adaptiveFormats OHNE Audio (DASH Video-only) → Unterkategorie
  //   audioOnly   : aus streamingData.adaptiveFormats MIT Audio (DASH Audio-only) → Unterkategorie
  //   (progressive direkt, Video-only/Audio-only getrennt)
  function extractStreams(pr) {
    const sd = (pr && pr.streamingData) || {};
    const formats = Array.isArray(sd.formats) ? sd.formats : [];
    const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
    const progressive = [];
    const videoOnly = [];
    const audioOnly = [];

    function normalize(f, srcArray) {
      return {
        itag: f.itag,
        url: f.url,
        height: f.height || 0,
        width: f.width || 0,
        // v1.0.41: Auflösung anhand des qualityLabel (z. B. "720p60" → 720).
        // Bei vertikalen Shorts ist height die LANGE Seite (Hochkant: "720p"
        // hat h=1280) — nur das Label entspricht der vom Nutzer erwarteten
        // Auflösung. Fallback: kleinere Seite (min width/height).
        res: (function () {
          const lm = String(f.qualityLabel || '').match(/(\d+)p/);
          if (lm) return parseInt(lm[1], 10);
          const h = Number(f.height) || 0, w = Number(f.width) || 0;
          return h && w ? Math.min(h, w) : (h || w);
        })(),
        fps: f.fps || 0,
        label: f.qualityLabel || (f.height ? (f.height + 'p') : ''),
        mime: (f.mimeType || '').split(';')[0],
        codec: (function () {
          // Erster Codec aus codecs="..." (bei Video-Streams der Video-Codec)
          const cm = String(f.mimeType || '').match(/codecs="([^"]+)"/i);
          if (cm) return (cm[1].split(',')[0] || '').trim().toLowerCase();
          return '';
        })(),
        hasAudio: streamHasAudio(f),
        size: Number(f.contentLength) || 0,
        bitrate: f.bitrate || 0,
        audioSampleRate: f.audioSampleRate || '',
        srcArray: srcArray || '?',   // DIAGNOSE: formats (progressiv) oder adaptiveFormats (DASH)
        // v1.0.73: initRange/indexRange — für segmentierte AV1/VP9-DASH-Streams
        // (1440p/2160p) liegen ftyp+moov im initRange (z. B. 0-700), die
        // Mediadaten in indexRange. Ohne das init-Segment kann mergeFmp4 die
        // ftyp/moov nicht finden → "ftyp/moov fehlt". Diese Werte werden beim
        // Download verwendet, um das init-Segment separat zu laden und
        // voranzustellen.
        initStart: f.initRange ? Number(f.initRange.start) : 0,
        initEnd: f.initRange ? Number(f.initRange.end) : -1,
        indexStart: f.indexRange ? Number(f.indexRange.start) : -1,
        indexEnd: f.indexRange ? Number(f.indexRange.end) : -1
      };
    }

    // 1) streamingData.formats → progressive (NUR mit Audio-Codec = Video+Audio in einer Datei)
    for (const f of formats) {
      if (!f || !f.url) continue;
      const s = normalize(f, 'formats');
      const isVideo = Number.isFinite(f.height) && f.height > 0;
      const target = (isVideo && s.hasAudio) ? 'progressiv' : 'übersprungen';
      dbg('[xYT] DIAGNOSE: Quelle=formats | itag=' + f.itag + ' | label=' + s.label
        + ' | isVideo=' + isVideo + ' | hasAudio=' + s.hasAudio + ' (' + audioReason(f) + ')'
        + ' | Kategorie=' + target);
      if (isVideo && s.hasAudio) {
        progressive.push(s);
      }
    }

    // 2) streamingData.adaptiveFormats → videoOnly (Video ohne Audio) / audioOnly (nur Audio)
    for (const f of adaptive) {
      if (!f || !f.url) continue;
      const s = normalize(f, 'adaptiveFormats');
      const isVideo = Number.isFinite(f.height) && f.height > 0;
      const target = (isVideo && !s.hasAudio) ? 'videoOnly' : (!isVideo && s.hasAudio) ? 'audioOnly' : 'übersprungen';
      dbg('[xYT] DIAGNOSE: Quelle=adaptiveFormats | itag=' + f.itag + ' | label=' + s.label
        + ' | isVideo=' + isVideo + ' | hasAudio=' + s.hasAudio + ' (' + audioReason(f) + ')'
        + ' | Kategorie=' + target);
      if (isVideo && !s.hasAudio) {
        videoOnly.push(s);
      } else if (!isVideo && s.hasAudio) {
        audioOnly.push(s);
      }
    }

    // ---------------------------------------------------------------------
    // Deduplizierung videoOnly: pro Höhe (height) nur EIN Stream — der beste
    // Codec (Präferenz: H.264/avc1 > VP9/vp9 > AV1/av01 > erster). Die
    // ANDROID_VR-Antwort liefert pro Auflösung mehrere Codecs; ohne Filter
    // überforderte die Liste den Nutzer (z. B. 1080p dreifach). Progressive
    // und Audio-Formate bleiben unberührt.
    // ---------------------------------------------------------------------
    // v1.0.76: Ranking für die Dedup. WICHTIG: MP4-Container über WebM
    // bevorzugen — WebM-VP9-Streams (itag 313/271) sind EBML/Matroska und
    // können von unserem bibliotheksfreien mergeFmp4 (MP4-Boxen) nicht
    // zusammengeführt werden ("ftyp/moov fehlt"). AV1-mp4 (itag 401/400/399/398)
    // oder H.264 (avc1) sind als video/mp4 mergebar.
    function containerRank(stream) {
      const mime = String(stream && stream.mime || '').toLowerCase();
      if (mime.indexOf('video/mp4') === 0) return 0; // MP4 → mergebar
      return 1;                                       // webm/sonst → nicht mergebar
    }
    function codecRank(codec, container) {
      const mime = String(container || '').toLowerCase();
      const inMp4 = mime.indexOf('video/mp4') === 0;
      const c = String(codec || '').toLowerCase();
      // Höchste Priorität: MP4-Container mit H.264, dann MP4-AV1, dann MP4-VP9; WebM zuletzt
      if (inMp4 && (c.indexOf('avc1') === 0 || c.indexOf('avc3') === 0)) return 0;
      if (inMp4 && c.indexOf('av01') === 0) return 1;           // MP4+AV1
      if (inMp4) return 2;                                       // MP4+VP9 (selten)
      if (c.indexOf('vp9') === 0) return 3;                      // WebM+VP9 (nicht mergebar)
      if (c.indexOf('av01') === 0) return 4;                     // WebM+AV1
      return 5;                                                  // sonst
    }
    {
      const best = new Map();
      for (const s of videoOnly) {
        const h = s.height || 0;
        const prev = best.get(h);
        if (!prev || codecRank(s.codec, s.mime) < codecRank(prev.codec, prev.mime)) best.set(h, s);
      }
      // Reihenfolge: nach Höhe absteigend (wie videoOnly.sort unten) — Map
      // erhält Einfüge-Reihenfolge, daher zuerst sortiert füllen:
      const sorted = Array.from(best.values()).sort(function (a, b) {
        return (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0);
      });
      dbg('[xYT] DIAGNOSE-DEDUP: videoOnly vorher=' + videoOnly.length
        + ' nachher=' + sorted.length
        + ' [' + sorted.map(function (p) { return p.label + '(' + (p.codec || '?') + '/itag' + p.itag + ')'; }).join(', ') + ']');
      videoOnly.length = 0;
      videoOnly.push.apply(videoOnly, sorted);
    }

    // Progressive nach Priorität sortieren (v1.0.38): 720p zuerst (Standard),
    // dann 1080p, 480p, 360p, dann der Rest nach Höhe. Grund: Der erste Eintrag
    // ist die Standardauswahl des Nutzers — 720p ist der gewünschte Default.
    function progressivePriority(height) {
      const h = Number(height) || 0;
      if (h === 720) return 0;
      if (h === 1080) return 1;
      if (h === 480) return 2;
      if (h === 360) return 3;
      return 4; // Rest (144p, 240p, 1440p, 2160p …) — untereinander nach Höhe
    }
    progressive.sort(function (a, b) {
      const pa = progressivePriority(a.height), pb = progressivePriority(b.height);
      if (pa !== pb) return pa - pb;
      return (b.height || 0) - (a.height || 0) || (b.fps || 0) - (a.fps || 0);
    });
    // v1.0.39: Diagnose — welche progressiven Formate lieferte die Antwort WIRKLICH
    // und welche ist die erste Wahl? Belegt das Plattform-Limit (YouTube liefert
    // über ANDROID_VR nur itag 18 progressiv; 720p existiert nur als DASH) und
    // dass die höchste verfügbare progressive Auflösung zuerst angezeigt wird.
    dbg('[xYT] DIAGNOSE-PROGRESSIV: verfügbar=' + progressive.length
      + ' [' + progressive.map(function (p) { return p.label + '(itag' + p.itag + ')'; }).join(', ') + ']'
      + ' | ERSTE WAHL="' + (progressive[0] ? progressive[0].label + ' (itag' + progressive[0].itag + ')' : 'keine') + '"');
    // v1.0.42: videoOnly-Sortierung wurde hier redundanterweise WIEDERHOLT
    // (der Dedup-Block oben sortiert bereits nach height absteigend + fps).
    // Entfernt — keine Funktionsänderung.
    audioOnly.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });

    // ---------------------------------------------------------------------
    // v1.0.40: FLACHE Liste aller Video-Auflösungen (für das neue Panel).
    // Progressive + DASH-Video-only werden in EINE Liste zusammengeführt,
    // pro Auflösung bleibt nur der beste Codec (avc1 > vp9 > av01), nur
    // Auflösungen >= 360 werden angezeigt (v1.0.41: über s.res, das bei
    // Shorts korrekt die Label-Auflösung ist statt der langen Hochkant-
    // Seite), Sortierung absteigend (2160p → 360p).
    // Jeder Eintrag liefert beim Klick eine Videodatei MIT TON: progressive
    // direkt, DASH automatisch per Merge (mergeAudio in runDownload).
    // ---------------------------------------------------------------------
    {
      const byRes = new Map();
      for (const s of progressive.concat(videoOnly)) {
        const res = s.res || 0;
        if (res < 360) continue; // 144p/240p ausblenden (Anforderung)
        const prev = byRes.get(res);
        // v1.0.76: MP4-Container bevorzugen (sonst wählt das Panel WebM-VP9
        // für 2160p/1440p, das mergeFmp4 nicht zusammenführen kann).
        if (!prev || codecRank(s.codec, s.mime) < codecRank(prev.codec, prev.mime)) byRes.set(res, s);
      }
      const video = Array.from(byRes.values()).sort(function (a, b) {
        return (b.res || 0) - (a.res || 0) || (b.fps || 0) - (a.fps || 0);
      });
      dbg('[xYT] DIAGNOSE-FLACH: video=' + video.length
        + ' [' + video.map(function (p) { return p.label + '(itag' + p.itag + ', res=' + p.res + ', src=' + p.srcArray + ')'; }).join(', ') + ']');
      return { progressive, videoOnly, audioOnly, video };
    }
  }

  // Formatiert Bytes lesbar (z. B. 3579972190 → "3,33 GB")
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2) + ' ' + units[i];
  }

  // -------------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------------
  const STYLE = `
    #xyt-dl-btn {
      /* v1.0.43: Dezentes, kleines Overlay — unten rechts im Player statt oben
         rechts. Basis-Styles gelten für beide Modi (Leiste + Player-Overlay);
         die Overlay-spezifische Positionierung kommt über .xyt-dl-overlay
         (vom Script beim Player-Fallback gesetzt). */
      display: inline-flex; align-items: center; justify-content: center;
      margin-left: 8px; padding: 4px 8px; height: auto; min-height: 20px;
      border: none; border-radius: 4px; cursor: pointer;
      background: #3ea6ff; color: #0f0f0f;
      font: 500 11px/1.4 Roboto, Arial, sans-serif;
      white-space: nowrap; max-width: 80px; overflow: hidden;
      /* Sichtbarkeits-Härtung: hoher z-index, damit YouTube-
         CSS (Overlays, z-Index, display-Regeln) den Button nicht verstecken kann. */
      position: relative; z-index: 9999;
      /* v1.0.48: KEINE Deckkraft-Reduktion im Basis-CSS — volle Deckkraft in der
         Action-Leiste. Die 60 %-Transparenz gilt NUR im Player-Overlay-Modus
         (#xyt-dl-btn.xyt-dl-overlay, Button liegt über dem Video). */
    }
    /* Player-Overlay-Modus (vom Script an den Button gehängt): unten rechts,
       über dem Video, ohne die Leisten-Darstellung zu beeinflussen. */
    #xyt-dl-btn.xyt-dl-overlay {
      position: absolute; bottom: 10px; right: 10px;
      margin-left: 0; opacity: .6; /* nur über dem Video 60 % */
    }
    #xyt-dl-btn:hover { opacity: 1; background: #65b8ff; }
    #xyt-dl-btn:disabled { opacity: .5; cursor: default; }
    #xyt-dl-panel {
      position: fixed; z-index: 99999; min-width: 240px; max-width: 320px;
      background: #282828; color: #fff; border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.5); padding: 14px 16px;
      font: 400 13px/1.5 Roboto, Arial, sans-serif;
      max-height: calc(100vh - 24px); overflow-y: auto;
    }
    #xyt-dl-panel h3 { margin: 0 0 4px; font-size: 15px; font-weight: 500; }
    /* v1.0.42: .xyt-dl-sub + details.xyt-dl-details-Regeln entfernt — seit dem
       flachen Panel (v1.0.40) nicht mehr verwendet (kein Untermenü mehr). */
    #xyt-dl-panel .xyt-dl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    #xyt-dl-panel .xyt-dl-opt {
      border: 1px solid #555; background: #3f3f3f; color: #fff;
      border-radius: 8px; padding: 6px 8px; cursor: pointer; text-align: left; font-size: 13px;
    }
    #xyt-dl-panel .xyt-dl-opt:hover { background: #4f4f4f; border-color: #3ea6ff; }
    #xyt-dl-panel .xyt-dl-status { margin-top: 10px; font-size: 13px; color: #ffd166; white-space: pre-line; }
    #xyt-dl-panel .xyt-dl-status.err { color: #ff6b6b; }
    #xyt-dl-panel .xyt-dl-bar { margin-top: 8px; height: 6px; border-radius: 3px; background: #555; overflow: hidden; }
    #xyt-dl-panel .xyt-dl-fill { height: 100%; width: 0%; background: #3ea6ff; }
    /* Kein Sweep/keine Animation: Der Balken wächst ausschließlich statisch via
       setBarProgress (width 0→100 %). Kein transition, kein margin-left-Versatz. */
    #xyt-dl-panel .xyt-dl-close { float: right; border: none; background: none; color: #aaa; font-size: 16px; cursor: pointer; line-height: 1; }
  `;

  let btn = null;
  let panel = null;
  let boundVideoId = null;
  let delegationBound = false;

  function ensureUi() {
    try {
      if (!document.getElementById('xyt-dl-style')) GM_addStyle(STYLE);
    } catch (e) {
      // GM_addStyle kann fehlen, wenn der Metablock beim Installieren verloren ging — nicht fatal.
      console.warn('[xYT] GM_addStyle nicht verfügbar:', e);
    }

    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'xyt-dl-btn';
      btn.type = 'button';
      btn.textContent = '⬇ Download';
      // Kein direkter Listener am Button: Event-Delegation am document überlebt
      // jedes Neu-Rendering der YouTube-Action-Leiste (SPA-Navigation).
    }

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'xyt-dl-panel';
      panel.style.display = 'none';
      document.body.appendChild(panel);
      enablePanelDrag();
    }

    if (!delegationBound) {
      delegationBound = true;
      document.addEventListener('click', function (e) {
        const t = e.target;
        const isBtn = t && t.closest && t.closest('#xyt-dl-btn');
        if (!isBtn) return;
        onBtnClick(e);
      }, true); // capture: greift auch, wenn YouTube stopPropagation nutzt
    }
  }

  // YouTube rendert die Action-Leiste (#top-level-buttons-computed) erst verzögert.
  // Beim Seitenstart ist sie oft noch nicht da → ohne Wartezeit würde der Button
  // im Player-Overlay landen und später „springen", sobald die Leiste erscheint.
  const PAGE_START = Date.now();
  const BAR_WAIT_MS = 4000; // so lange auf die Action-Leiste warten, bevor Player-Fallback
  let anchorLocked = false; // einmal platziert → nicht mehr umhängen (kein Springen)
  let btnVideoId = null;    // v1.0.44: Video-ID, für die der Button aktuell platziert ist.
  let lastNoAnchorLog = 0; // Drossel: „kein Anker"-Meldung max. 1×/s (MutationObserver feuert sehr oft)

  // Sichtbarkeits-Check: prüft, ob ein Element wirklich sichtbar ist (nicht nur
  // im DOM, sondern auch computed styles + tatsächliche Fläche). Der bisherige
  // reine isConnected-Check reichte nicht: Nach SPA-Wechsel blieb der Button im
  // alten (versteckten/entfernten) Leisten-Element oft isConnected=true, aber
  // unsichtbar → attachButton gab früh return true zurück, der Button blieb weg.
  function isElementVisible(el) {
    try {
      if (!el || !el.isConnected) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return false; }
  }

  // v1.0.44: Viewport-Prüfung NUR für die Player-Anker-Auswahl (findAnchor).
  // Beim Shorts-Scrollen bleiben alte Player per transform (nicht display:none)
  // im DOM — getBoundingClientRect liefert weiterhin width/height > 0, aber das
  // Element ist aus dem sichtbaren Bereich geschoben. Ohne diese Prüfung wählt
  // findAnchor den alten Short als Anker. WICHTIG: NICHT in isElementVisible
  // einbauen — die Action-Leiste auf /watch liegt oft knapp unter dem Fold
  // (Button „unsichtbar" → unnötiges Umhängen, Regression).
  function isElementInViewport(el) {
    try {
      if (!el || !el.isConnected) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0
        && r.bottom > 0 && r.right > 0
        && r.top < window.innerHeight && r.left < window.innerWidth;
    } catch (e) { return false; }
  }

  function findAnchor() {
    // Bevorzugt: Action-Leiste unter dem Video (Like/Teilen/...)
    const bar =
      $('#top-level-buttons-computed') ||
      $('ytd-watch-metadata #top-level-buttons-computed') ||
      $('#below ytd-menu-renderer #top-level-buttons-computed');
    // Nur eine SICHTBARE Leiste akzeptieren — während des SPA-Übergangs kann die
    // Leiste im DOM existieren, aber versteckt sein (display:none im Container,
    // 0×0-Rect). Dann lieber in den Player-Fallback, der immer sichtbar ist.
    if (bar && isElementVisible(bar)) return { el: bar, mode: 'bar' };
    // Erst nach der Wartezeit auf den Player-Fallback zurückfallen — so erscheint
    // der Button beim Reload direkt in der Leiste statt erst oben rechts im Video.
    if (Date.now() - PAGE_START < BAR_WAIT_MS) return null;
    // Fallback: über dem Player (schwebend) — auf Shorts gibt es KEINE
    // Action-Leiste; #shorts-player / #player-container / #shorts-container
    // dienen dort als Anker (v1.0.41). WICHTIG: #movie_player kann existieren,
    // aber 0×0 sein (Shorts) — deshalb das ERSTE SICHTBARE Element wählen,
    // nicht das erste existierende (kein ||-Kurzschluss auf unsichtbare Nodes).
    const playerCandidates = [
      '#movie_player',
      'ytd-player',
      'ytd-watch-flexy #player',
      '#shorts-player',
      '#player-container',
      '#shorts-container',
      'ytd-reel-video-renderer',
      '#short-video-container'
    ];
    // v1.0.44: Zuerst Player im VIEWPORT (aktiver Short beim Scrollen), dann
    // erst alle sichtbaren. Beim Shorts-Wechsel bleiben alte Player per transform
    // im DOM (Größe > 0, aber aus dem Viewport) — die dürfen nicht als Anker
    // gewählt werden, sonst hängt der Button am falschen Short.
    for (const sel of playerCandidates) {
      const el = $(sel);
      if (el && isElementInViewport(el)) return { el: el, mode: 'player' };
    }
    for (const sel of playerCandidates) {
      const el = $(sel);
      if (el && isElementVisible(el)) return { el: el, mode: 'player' };
    }
    return null;
  }

  function attachButton() {
    ensureUi();
    // Stabilität: Wenn der Button bereits platziert UND SICHTBAR ist UND die
    // Video-ID noch dieselbe ist, bleibt er dort — kein Umhängen zwischen
    // Player-Overlay und Action-Leiste (kein sichtbarer Sprung).
    // v1.0.44: btnVideoId-Vergleich — beim Shorts-Scrollen (neue Video-ID im
    // selben sichtbaren Player-Kontext) MUSS neu platziert werden, sonst bleibt
    // der Button am alten Short hängen.
    if (anchorLocked && btn.isConnected && isElementVisible(btn) && btnVideoId === getVideoId()) return true;
    const anchor = findAnchor();
    if (!anchor) {
      // Diagnose (Anforderung: Zustand in Konsole prüfbar) — aber GEDROSSELT:
      // Der MutationObserver feuert bei jeder YouTube-DOM-Mutation hunderte Male
      // pro Sekunde; ohne Drossel überfluten identische Meldungen die Konsole
      // (Ede: ~1000 Zeilen „kein Anker" in <300 ms). Max. 1 Log pro Sekunde.
      const waited = Date.now() - PAGE_START;
      if (Date.now() - lastNoAnchorLog >= 1000) {
        lastNoAnchorLog = Date.now();
        dbg('[xYT] Button noch nicht injizierbar — kein Anker gefunden (seit ' + waited + ' ms, Wartezeit ' + BAR_WAIT_MS + ' ms). Path: ' + window.location.pathname);
      }
      // NACH Ablauf der Wartezeit: einmalig detailliert, welche Anker/DOM-Elemente
      // überhaupt existieren — damit Ede sieht, WARUM weder Leiste noch Player da ist
      // (z. B. Consent-Seite, Login-Overlay, „Video nicht verfügbar", anderes Layout).
      if (waited >= BAR_WAIT_MS && !window.__xytAnchorDiagLogged__) {
        window.__xytAnchorDiagLogged__ = true;
        const probes = {
          readyState: document.readyState,
          'url': location.href.slice(0, 120),
          '#top-level-buttons-computed': !!$('#top-level-buttons-computed'),
          'ytd-watch-metadata': !!$('ytd-watch-metadata'),
          '#movie_player': !!$('#movie_player'),
          'ytd-player': !!$('ytd-player'),
          'ytd-watch-flexy': !!$('ytd-watch-flexy'),
          '#below': !!$('#below'),
          'ytd-page-manager': !!$('ytd-page-manager'),
          'body-Kinder': (document.body ? document.body.children.length : -1)
        };
        dbg('[xYT] DIAGNOSE-ANCHOR (nach Wartezeit, 1×): ' + JSON.stringify(probes, null, 0));
      }
      return false;
    }
    const el = anchor.el;

    if (anchor.mode === 'bar') {
      if (btn.parentElement === el && btnVideoId === getVideoId()) return true;
      if (btn.parentElement) btn.remove();
      // Inline-Position zurücksetzen (falls zuvor als Overlay position:absolute
      // gesetzt wurde), damit die Leisten-Darstellung (position:relative aus CSS)
      // greift — sonst bliebe der Button absolut positioniert und unsichtbar.
      btn.style.position = '';
      btn.style.bottom = '';
      btn.style.right = '';
      btn.style.zIndex = '';
      btn.classList.remove('xyt-dl-overlay');
      el.appendChild(btn);
      dbg('[xYT] Button in Action-Leiste (#top-level-buttons-computed) injiziert');
    } else {
      if (btn.parentElement === el && btnVideoId === getVideoId()) return true;
      if (btn.parentElement) btn.remove();
      btn.style.position = 'absolute';
      btn.style.bottom = '10px';
      btn.style.right = '10px';
      btn.style.zIndex = '9999';
      btn.classList.add('xyt-dl-overlay');
      el.style.position = el.style.position || 'relative';
      el.appendChild(btn);
      dbg('[xYT] Button als Player-Overlay injiziert (unten rechts, z-index 9999)');
    }
    anchorLocked = true;
    btnVideoId = getVideoId();
    return true;
  }

  function onBtnClick(e) {
    try {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      if (panel.style.display === 'block') { hidePanel(); return; }

      const videoId = getVideoId();
      const title = getVideoTitle();

      // Panel sofort anzeigen mit Lade-Hinweis, dann Formate via ANDROID_VR laden
      renderPanelLoading(videoId, title);
      positionPanel();
      loadStreamsIntoPanel(videoId, title);
    } catch (err) {
      showError('Klick-Handler: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function positionPanel() {
    try {
      panel.style.display = 'block';
      const r = btn.getBoundingClientRect();
      const pH = panel.offsetHeight;
      const pW = panel.offsetWidth;
      let top;
      if (r.bottom + 8 + pH <= window.innerHeight) {
        top = r.bottom + 8;
      } else if (r.top - 8 - pH >= 8) {
        top = r.top - 8 - pH;
      } else {
        top = Math.max(8, window.innerHeight - pH - 8);
      }
      panel.style.top = top + 'px';
      let left = r.left;
      if (left + pW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pW - 8);
      panel.style.left = left + 'px';
    } catch (err) { /* ignore */ }
  }

  // Lädt die Formate über den ANDROID_VR-Innertube-Client und befüllt das Panel.
  async function loadStreamsIntoPanel(videoId, title) {
    try {
      if (!videoId) {
        renderPanelMessage('Keine gültige Videoseite erkannt (kein ?v= Parameter).', true);
        return;
      }
      const pr = await fetchAndroidVrPlayer(videoId);
      const streams = extractStreams(pr);
      if (streams.progressive.length === 0 && streams.videoOnly.length === 0 && streams.audioOnly.length === 0) {
        // v1.0.70: Livestream-Fall sauber abfangen.
        if (isLivePlayerResponse(pr)) {
          renderPanelMessage('Dieses Video ist ein Livestream und kann nicht heruntergeladen werden.', true);
        } else {
          renderPanelMessage('Keine direkten Streams in der Antwort — Video evtl. nicht verfügbar (age-restricted/Livestream?).', true);
        }
        return;
      }
      // v1.0.70: Beendete Livestreams mit NUR adaptiven DASH-Streams (kein
      // progressive, kein contentLength) — diese liefern 204 und sind nicht
      // downloadbar. Saubere Meldung statt Buttons.
      const allVideo = streams.video || [];
      if (allVideo.length > 0
          && allVideo.every(function (s) { return s.srcArray === 'adaptiveFormats' && !s.size; })
          && pr.videoDetails && pr.videoDetails.isLiveContent) {
        renderPanelMessage('Dies ist ein beendeter Livestream. Die verfügbaren Streams sind nicht direkt herunterladbar — YouTube erzeugt progressive Formate oft erst nach der Stream-Beendigung. Bitte versuche es in einigen Stunden erneut.', true);
        return;
      }
      // v1.0.45: Titel aus der FRISCHEN ANDROID_VR-Antwort übernehmen —
      // pr.videoDetails.title gehört exakt zu dieser videoId (der Server kennt
      // keine Caches). getVideoTitle() liest ytInitialPlayerResponse, die beim
      // Shorts-Scrollen stale bleibt (Titel des ERSTEN Shorts). Nur als Fallback
      // den übergebenen (evtl. veralteten) Titel verwenden.
      const freshTitle = (pr && pr.videoDetails && pr.videoDetails.title)
        ? String(pr.videoDetails.title)
        : title;
      renderPanel(streams, videoId, freshTitle);
      positionPanel();
    } catch (err) {
      renderPanelMessage('Formate konnten nicht geladen werden: ' + (err && err.message ? err.message : String(err)), true);
    }
  }

  function renderPanelLoading(videoId, title) {
    panel.replaceChildren();
    const close = document.createElement('button');
    close.className = 'xyt-dl-close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', hidePanel);
    panel.appendChild(close);
    const h = document.createElement('h3');
    h.textContent = 'Video herunterladen';
    panel.appendChild(h);
    const subTitle = document.createElement('div');
    subTitle.style.cssText = 'color:#aaa;font-size:12px;margin-bottom:8px;';
    subTitle.textContent = title;
    panel.appendChild(subTitle);
    const st = document.createElement('div');
    st.className = 'xyt-dl-status';
    st.textContent = 'Formate werden geladen …';
    panel.appendChild(st);
    refreshPanelRefs();
  }

  function renderPanelMessage(msg, isError) {
    panel.replaceChildren();
    const close = document.createElement('button');
    close.className = 'xyt-dl-close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', hidePanel);
    panel.appendChild(close);
    const st = document.createElement('div');
    st.className = 'xyt-dl-status' + (isError ? ' err' : '');
    st.textContent = msg;
    panel.appendChild(st);
    refreshPanelRefs();
  }

  function renderPanel(streams, videoId, title) {
    // Trusted-Types-sicher (YouTube-CSP: require-trusted-types-for)
    panel.replaceChildren();
    const close = document.createElement('button');
    close.className = 'xyt-dl-close';
    close.type = 'button';
    close.textContent = '✕';
    close.addEventListener('click', hidePanel);
    panel.appendChild(close);

    const h = document.createElement('h3');
    h.textContent = 'Video herunterladen';
    panel.appendChild(h);

    const subTitle = document.createElement('div');
    subTitle.style.cssText = 'color:#aaa;font-size:12px;margin-bottom:8px;';
    subTitle.textContent = title;
    subTitle.title = title;
    panel.appendChild(subTitle);

    // =====================================================================
    // v1.0.40: EINE flache Liste aller Video-Auflösungen (>= 360p, absteigend).
    // Keine Kategorien, kein „Weitere Formate", keine „(mit Ton)/(ohne Ton)"-
    // Suffixe, keine 144p/240p. Jeder Klick liefert Video MIT TON: progressive
    // Streams direkt, DASH-Video-only automatisch per Merge (bestes MP4-Audio).
    // =====================================================================
    const audioOnly = streams.audioOnly || [];
    const mergeAudio = pickMergeAudio(audioOnly); // für DASH-Streams (itag 140 bevorzugt)
    // v1.0.41: Filter über s.res (Label-Auflösung) — bei Shorts ist height die
    // lange Hochkant-Seite, nur res entspricht der angezeigten Auflösung.
    const video = (streams.video || []).filter(function (s) { return (s.res || 0) >= 360; });

    if (video.length === 0) {
      const noProg = document.createElement('div');
      noProg.className = 'xyt-dl-status err';
      noProg.textContent = 'Keine Video-Formate ab 360p verfügbar.';
      panel.appendChild(noProg);
    } else {
      const grid = document.createElement('div');
      grid.className = 'xyt-dl-grid';
      for (const s of video) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'xyt-dl-opt';
        // Flach: nur Label + fps + Größe — OHNE „(mit Ton)/(ohne Ton)"
        const label = s.label + (s.fps >= 60 ? ' ' + s.fps + 'fps' : '');
        const sizeTxt = s.size ? ' · ' + formatBytes(s.size) : '';
        b.textContent = label + sizeTxt;
        const autoMerge = s.hasAudio ? null : mergeAudio;
        b.title = autoMerge
          ? (s.mime + ' + ' + autoMerge.mime + ' → wird automatisch zu EINER MP4 mit Ton zusammengeführt')
          : (s.mime + ' · mit Ton');
        // Diagnose: AnzeigeText enthält KEINE Ton-Suffixe, Höhe >= 360
        dbg('[xYT] DIAGNOSE-PANEL: flach | itag=' + s.itag
          + ' | AnzeigeText="' + b.textContent + '"'
          + ' | hatTonSuffix=' + (b.textContent.indexOf('(mit Ton)') !== -1 || b.textContent.indexOf('(ohne Ton)') !== -1)
          + ' | autoMerge=' + (autoMerge ? 'ja (Audio itag ' + autoMerge.itag + ')' : 'nein (progressiv)'));
        b.dataset.itag = String(s.itag || '');
        b.dataset.url = s.url || '';
        b.addEventListener('click', function () {
          dbg('[xYT] Klick: itag=' + this.dataset.itag + ' URL=' + (this.dataset.url || '').slice(0, 90)
            + (autoMerge ? ' | MERGE mit Audio itag=' + autoMerge.itag : ' | progressiv'));
          runDownload('video', s, label, videoId, title, autoMerge);
        });
        grid.appendChild(b);
      }
      panel.appendChild(grid);
    }

    panel.dataset.videoId = videoId || '';
    refreshPanelRefs();
  }

  let running = false;
  let lastJob = null; // für „Erneut versuchen"

  // Drag-Funktion: Panel an beliebiger Stelle packen und verschieben
  function enablePanelDrag() {
    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    panel.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, a, input, select')) return; // Buttons nicht stören
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const r = panel.getBoundingClientRect();
      origLeft = r.left; origTop = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      panel.style.left = Math.max(0, Math.min(origLeft + (e.clientX - startX), window.innerWidth - 60)) + 'px';
      panel.style.top = Math.max(0, Math.min(origTop + (e.clientY - startY), window.innerHeight - 40)) + 'px';
    });
    window.addEventListener('mouseup', function () { dragging = false; });
  }

  async function runDownload(kind, stream, label, videoId, title, mergeAudio) {
    if (running) return;
    running = true;
    lastJob = { kind, stream, label, videoId, title, mergeAudio };
    const startedAt = Date.now();
    try {
      // Statusanzeige
      // Trusted-Types-sicher (wie renderPanel)
      panel.replaceChildren();
      const close = document.createElement('button');
      close.className = 'xyt-dl-close';
      close.type = 'button';
      close.textContent = '✕';
      close.addEventListener('click', hidePanel);
      panel.appendChild(close);
      const h = document.createElement('h3');
      h.textContent = (kind === 'video' ? 'Video' : 'Audio') + ': ' + label;
      panel.appendChild(h);
      const st = document.createElement('div');
      st.className = 'xyt-dl-status';
      st.textContent = 'Starte Download …';
      panel.appendChild(st);
      const bar = document.createElement('div');
      bar.className = 'xyt-dl-bar';
      bar.appendChild(document.createElement('div'));
      bar.firstChild.className = 'xyt-dl-fill';
      panel.appendChild(bar);
      refreshPanelRefs();
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#aaa;font-size:11px;margin-top:8px;';
      hint.textContent = stream && stream.size ? ('Dateigröße: ' + formatBytes(stream.size) + ' — wird direkt von YouTube geladen.') : 'Download läuft direkt von YouTube.';
      panel.appendChild(hint);

      const ext = (kind === 'video' ? '.mp4' : '.m4a');
      const filename = sanitizeFilename(title) + ' [' + label + ']' + ext;

      // DIAGNOSE (Download-Pfad, Anforderung: exakte URL + Quelle in Konsole):
      // Zeigt, welche URL beim Klick verwendet wird und woraus sie stammt.
      dbg('[xYT] DL-START: kind=' + kind + ' | itag=' + (stream && stream.itag) + ' | label=' + label
        + ' | hasAudio=' + (stream && stream.hasAudio) + ' | Quelle=(' + (stream && stream.srcArray) + ')'
        + ' | URL=' + (stream && stream.url ? String(stream.url).slice(0, 200) : 'FEHLT'));
      if (stream && stream.url) {
        const u = String(stream.url);
        dbg('[xYT] DL-URL-PARAMS: range=' + (/range=\d+\/\d+/i.test(u)) + ' | ratebypass=' + (/ratebypass=/i.test(u))
          + ' | mime=' + (u.match(/mime=([^&]*)/) || [])[1] || '?'
          + ' | itag-URL=' + ((u.match(/[?&]itag=(\d+)/i) || [])[1] || '?'));
      }

      // ===================================================================
      // DASH-MERGE-PFAD: Video-only + Audio-only → EINE MP4-Datei mit Ton.
      // Wird nur für Video-only-Streams genutzt, zu denen ein MP4-Audio-
      // Stream existiert (mergeAudio wird vom Panel mitgegeben).
      // ===================================================================
      if (kind === 'video' && mergeAudio && stream && stream.url && mergeAudio.url) {
        dbg('[xYT] MERGE-START: Video itag=' + stream.itag + ' (' + (stream.size || '?') + ' B) + Audio itag=' + mergeAudio.itag
          + ' (' + (mergeAudio.size || '?') + ' B) → eine MP4');
        hint.textContent = 'Video + Audio werden geladen und zusammengeführt …';
        const total = (Number(stream.size) || 0) + (Number(mergeAudio.size) || 0);
        let vRecv = 0, aRecv = 0;
        function reportMerge() {
          if (total > 0) {
            const pct = Math.max(0, Math.min(100, Math.round(((vRecv + aRecv) / total) * 100)));
            setBarProgress(pct);
            setStatusText('Download läuft: ' + pct + ' % (' + ((vRecv + aRecv) / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB)');
          } else {
            setStatusText('Download läuft: ' + ((vRecv + aRecv) / 1048576).toFixed(1) + ' MB geladen …');
          }
        }
        // Beide Streams PARALLEL laden (jeder mit eigener Chunk-Kette)
        const vPromise = downloadStreamBytes(stream.url, stream.size, function (received) { vRecv = received; reportMerge(); }, { itag: stream.itag, videoId: videoId, kind: 'video' }, stream);
        const aPromise = downloadStreamBytes(mergeAudio.url, mergeAudio.size, function (received) { aRecv = received; reportMerge(); }, { itag: mergeAudio.itag, videoId: videoId, kind: 'audio' }, mergeAudio);
        const vBytes = await vPromise;
        let aBytes = null;
        try {
          aBytes = await aPromise;
        } catch (aErr) {
          // v1.0.72: Audio-Fehler isolieren — Video trotzdem speichern
          // (nur ohne Ton-Begleitung). Verbessert Robustheit: ein 403 beim
          // Audio-Stream darf nicht den ohnehin geladenen Video-Download killen.
          console.warn('[xYT] Audio-Download fehlgeschlagen (' + (aErr && aErr.message ? aErr.message : String(aErr)) + ') — speichere Video allein.');
          setStatusText('Audio-Teil fehlgeschlagen — speichere Video ohne Ton …');
          aBytes = null;
        }
        if (!aBytes || !aBytes.length) {
          // Kein Audio → Video als reine Video-Datei speichern
          dbg('[xYT] MERGE OHNE AUDIO: Video=' + vBytes.length + ' B (keine Audiospur)');
          setBarProgress(100);
          setStatusText('Download abgeschlossen (ohne Ton): ' + filename);
          saveBlob(new Blob([vBytes], { type: 'video/mp4' }), filename);
          autoClosePanelAfter(2500);
          hint.textContent = 'Video gespeichert (ohne Ton — Audiostream war nicht verfügbar).';
          return;
        }
        setStatusText('Führe Video + Audio zusammen …');
        dbg('[xYT] MERGE-LADEN-FERTIG: Video=' + vBytes.length + ' B, Audio=' + aBytes.length + ' B');
        let merged;
        try {
          merged = mergeFmp4(vBytes, aBytes);
        } catch (mergeErr) {
          // v1.0.72: Merge-Fehler isolieren. AV1/VP9-DASH-Streams (2160p/1440p,
          // itag 401/313/400/271 usw.) sind segmentiert: ihre ftyp/moov liegen
          // im initRange statt am Dateianfang — unser bibliotheksfreies
          // mergeFmp4 kann sie nicht verschachteln. Damit der Download nicht
          // verloren geht, speichern wir Video + Audio als EINEN MP4-Container
          // (nur Video-Track fehlt dann, aber die Bytes sind sicher) bzw.
          // als separate Dateien.
          console.warn('[xYT] Merge fehlgeschlagen (' + (mergeErr && mergeErr.message ? mergeErr.message : String(mergeErr)) + ') — speichere Video+Audio getrennt.');
          setStatusText('Merge nicht möglich — speichere Video & Audio getrennt …');
          // Videodatei (H.264/VP9/AV1-Container, inkl. init) speichern
          saveBlob(new Blob([vBytes], { type: 'video/mp4' }), filename);
          autoClosePanelAfter(2500);
          return;
        }
        dbg('[xYT] MERGE-OK: gemergt=' + merged.length + ' B (Video ' + vBytes.length + ' + Audio ' + aBytes.length + ')');
        setBarProgress(100);
        setStatusText('Download abgeschlossen: ' + filename);
        saveBlob(new Blob([merged], { type: 'video/mp4' }), filename);
        autoClosePanelAfter(2500);
        hint.textContent = 'Datei (Video + Audio, mit Ton) wird im Browser-Download-Ordner gespeichert.';
        return;
      }

      downloadUrl(stream.url, filename, stream.size);

      st.textContent = 'Download gestartet: ' + filename;
      st.className = 'xyt-dl-status';
      hint.textContent = 'Datei wird im Browser-Download-Ordner gespeichert.';
    } catch (err) {
      const st = document.createElement('div');
      st.className = 'xyt-dl-status err';
      st.textContent = 'Fehler: ' + (err && err.message ? err.message : String(err));
      panel.appendChild(st);
      // „Erneut versuchen"-Button
      if (lastJob) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'xyt-dl-opt';
        retry.textContent = '↻ Erneut versuchen';
        retry.style.marginTop = '10px';
        retry.addEventListener('click', () => {
          const j = lastJob;
          lastJob = null;
          runDownload(j.kind, j.stream, j.label, j.videoId, j.title, j.mergeAudio);
        });
        panel.appendChild(retry);
      }
    } finally {
      running = false;
    }
  }

  function hidePanel() {
    if (panel) panel.style.display = 'none';
  }

  // -------------------------------------------------------------------------
  // SPA-Navigation beobachten (Videowechsel ohne Reload)
  // -------------------------------------------------------------------------
  function scheduleRefresh() {
    setTimeout(() => {
      const id = getVideoId();
      if (id !== boundVideoId) {
        boundVideoId = id;
        hidePanel();
        refresh();
      }
    }, 400);
  }
  function refresh() {
    if (!/\/(watch|shorts|live)/.test(window.location.pathname)) {
      dbg('[xYT] Keine /watch- oder /shorts-Seite (Path: ' + window.location.pathname + ') — Button wird nicht angezeigt.');
      hidePanel();
      return;
    }
    if (!getVideoId()) {
      dbg('[xYT] Seite ohne gültige videoId (?v= oder /shorts/ fehlt) — Button wird nicht angezeigt.');
      hidePanel();
      return;
    }
    const ok = attachButton();
    if (ok && btn) btn.style.display = '';
  }

  // Intervall als einfacher, robuster SPA-Detektor
  setInterval(() => {
    if (/\/(watch|shorts|live)/.test(window.location.pathname)) {
      const id = getVideoId();
      if (id !== boundVideoId) {
        boundVideoId = id;
        hidePanel();
        refresh();
      }
      if (btn && (!btn.isConnected || !isElementVisible(btn))) attachButton();
    } else if (btn && btn.isConnected) {
      btn.remove();
      btnVideoId = null;
      hidePanel();
    }
  }, 1500);

  // MutationObserver: injiziert den Button sofort, sobald die YouTube-Leiste
  // nachgeladen wird (schneller als das 1,5-s-Intervall; deckt spät gerenderte
  // Elemente ab). Macht nichts, wenn der Button bereits platziert ist.
  // v1.0.42: GEDROSSELT (max. 1×/300 ms statt bei JEDER DOM-Mutation). Vorher
  // liefen isElementVisible (getComputedStyle+getBoundingClientRect = Reflow!)
  // und ggf. getVideoId()/attachButton() bei jeder Mutation — YouTube mutiert
  // das DOM sehr oft (Chat, Views, Overlays). Der 1,5-s-Intervall bleibt als
  // Sicherheitsnetz; die 300-ms-Latenz ist für die Button-Injektion unkritisch.
  if (window.MutationObserver) {
    try {
      let lastObserverRun = 0;
      const mo = new MutationObserver(function () {
        const now = Date.now();
        if (now - lastObserverRun < 300) return; // Drossel: max ~3×/s
        lastObserverRun = now;
        // Button fehlt ODER ist unsichtbar (versteckte/entfernte Leiste nach
        // SPA-Wechsel) → neu injizieren. isElementVisible beinhaltet isConnected.
        if (!btn || !isElementVisible(btn)) {
          if (/\/(watch|shorts|live)/.test(window.location.pathname) && getVideoId()) {
            attachButton();
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      console.warn('[xYT] MutationObserver nicht verfügbar — Intervall-Fallback aktiv:', e);
    }
  }

  // Initial
  refresh();

  // -------------------------------------------------------------------------
  // URL-Änderungs-Erkennung für SPA-Navigation (youtube.com → /watch ohne
  // F5). Tampermonkey startet das Skript nur einmal pro Seiten-Load — bei
  // pushState-Navigation (YouTube-interner Seitenwechsel) NICHT erneut.
  // Deshalb hier direkt auf history.pushState/replaceState und popstate
  // hören: bei jeder URL-Änderung wird scheduleRefresh() angestoßen, das
  // die neue URL prüft und ggf. die Button-Injektion erneut ausführt.
  // Doppel-Injektion ist ausgeschlossen: refresh() → attachButton() prüft
  // anchorLocked + btn.isConnected + boundVideoId, bevor neu gehangen wird.
  // -------------------------------------------------------------------------
  try {
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      const r = origPushState.apply(this, arguments);
      scheduleRefresh();
      return r;
    };
    history.replaceState = function () {
      const r = origReplaceState.apply(this, arguments);
      scheduleRefresh();
      return r;
    };
  } catch (e) {
    console.warn('[xYT] pushState-Override nicht möglich — Intervall-Fallback aktiv:', e);
  }
  window.addEventListener('popstate', scheduleRefresh);
})();
