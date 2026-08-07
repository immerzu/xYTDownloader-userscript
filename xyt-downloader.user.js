// ==UserScript==
// @name         xYTDownloader
// @namespace    local:xyt-downloader
// @version      1.0.51
// @description  One-click YouTube video downloader. Supports all qualities up to 4K with audio. Works on /watch and /shorts. No external APIs, direct ANDROID_VR client. DASH merging for high resolutions with sound.
// @description:de  YouTube-Downloader-Userscript mit einem Klick. Unterstützt alle Qualitäten bis 4K mit Ton. Funktioniert auf /watch und /shorts. Keine externen APIs, direkter ANDROID_VR-Client. DASH-Merging für hohe Auflösungen mit Ton.
// @description:ru  Пользовательский скрипт для скачивания видео с YouTube в один клик. Поддерживает все качества до 4K со звуком. Работает на /watch и /shorts. Без внешних API, прямой клиент ANDROID_VR. Слияние DASH для высоких разрешений со звуком.
// @author       Ede
// @match        *://www.youtube.com/*
// @match        *://youtube.com/*
// @match        *://*.youtube.com/*
// @match        *://www.youtube.com/shorts/*
// @match        *://youtube.com/shorts/*
// @match        *://*.youtube.com/shorts/*
// @exclude      *://music.youtube.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_addStyle
// @connect      savenow.to
// @connect      *.savenow.to
// @connect      p.savenow.to
// @connect      lbserver.xyz
// @connect      *.lbserver.xyz
// @connect      p.lbserver.xyz
// @connect      dubs.io
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
 *   ANDROID_VR client (the same method JDownloader 2 uses). No external
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
  const MY_VERSION = '1.0.51';
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
  // Konfiguration (Download-API; aus dem Referenz-Skript übernommen)
  // -------------------------------------------------------------------------
  const API_KEY = 'HIER_API_KEY_EINFUEGEN'; // Platzhalter — echter Key nur in der veröffentlichten Greasy-Fork-Version (savenow-Fallback ist deaktiviert)
  const SAVENOW_BASES = ['https://p.savenow.to', 'https://p.lbserver.xyz'];
  const DUBS_START = 'https://dubs.io/wp-json/tools/v1/download-video';
  const DUBS_STATUS = 'https://dubs.io/wp-json/tools/v1/status-video';

  // -------------------------------------------------------------------------
  // ANDROID_VR-Innertube-Client (Methode von JDownloader2, siehe ANALYSE_JD2_YOUTUBE.md)
  // Liefert direkte, signierte googlevideo-Stream-URLs mit exakter contentLength
  // (ohne POT-Token, ohne 403 — im Gegensatz zum WEB-Client).
  // -------------------------------------------------------------------------
  const YT_PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
  const ANDROID_VR_CONFIG = {
    clientName: 'ANDROID_VR',
    clientVersion: '1.65.10',
    deviceMake: "'Oculus",
    deviceModel: "'Quest 3",
    androidSdkVersion: 32,
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    osName: 'Android',
    osVersion: '12L',
    hl: 'de',
    timeZone: 'Europe/Berlin',
    utcOffsetMinutes: 120
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
    // die ID steckt im Pfad. Zuerst ?v= prüfen, dann /shorts/-Pfad, dann PlayerResponse.
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
  // Download per manuellem Chunking (Range-Requests) — Methode von JDownloader2.
  // Grund: GM_xmlhttpRequest.onprogress mit arraybuffer feuert in Yandex/
  // Tampermonkey NICHT inkrementell (ein einziger Event mit fast komplettem
  // loaded → „2935.9 MB geladen" sofort, Balken springt). Stattdessen laden wir
  // die Datei in ~4-MB-Stücken per Range-Header und zählen die empfangenen
  // Bytes selbst — der Fortschritt wächst damit garantiert inkrementell.
  // -------------------------------------------------------------------------
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB je Chunk (JD2 nutzt ~4,8 MB)

  function downloadUrl(url, filename, expectedSize) {
    let knownTotal = Number(expectedSize) || 0;   // v1.0.38: let, damit die Probe die Größe nachtragen kann
    if (typeof GM_xmlhttpRequest !== 'function') {
      fallbackDownload(url, filename);
      return true;
    }
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
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: String(url),
          headers: { 'Range': 'bytes=0-0' },
          responseType: 'arraybuffer',
          timeout: 15000,
          onload: function (res) {
            try {
              const cr = String(res && res.responseHeaders || '');
              const m = cr.match(/content-range:\s*bytes\s+0-0\/(\d+)/i);
              if (res && res.status === 206 && m && Number(m[1]) > 0) {
                knownTotal = Number(m[1]);
                dbg('[xYT] DL-PROBE: Content-Range → Gesamtgröße ' + knownTotal + ' B');
                nextChunk(0);
                return;
              }
              // Server lieferte 200 (Range ignoriert) → komplette Datei schon da
              if (res && res.status === 200 && res.response && res.response.byteLength > 0) {
                chunks.push(res.response);
                received = res.response.byteLength;
                dbg('[xYT] DL-PROBE: Status 200, komplette Datei (' + received + ' B) direkt übernommen');
                finishDownload();
                return;
              }
              console.warn('[xYT] DL-PROBE: keine Größe ermittelbar (Status ' + (res && res.status) + ') — Fortschritt ohne %');
              nextChunk(0);
            } catch (e2) {
              console.warn('[xYT] DL-PROBE-Fehler:', e2);
              nextChunk(0);
            }
          },
          onerror: function () { nextChunk(0); },
          ontimeout: function () { nextChunk(0); }
        });
      } catch (e) {
        console.warn('[xYT] DL-PROBE-Exception:', e);
        nextChunk(0);
      }
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
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: String(url),
          headers: { 'Range': 'bytes=' + start + '-' + end },
          responseType: 'arraybuffer',
          timeout: 60000,
          onload: function (res) {
            try {
              const buf = res && res.response;
              if (!buf || !buf.byteLength) throw new Error('leere Chunk-Antwort (Status ' + (res && res.status) + ')');
              chunks.push(buf);
              received += buf.byteLength;
              // DIAGNOSE: Was kam real zurück? Status 206 = Range ok, 200 = kompletter Body!
              dbg('[xYT] DL-CHUNK-OK: Status=' + (res && res.status) + ' | angefordert=' + (end - start + 1) + ' B | erhalten=' + buf.byteLength + ' B | received-gesamt=' + received);
              if (res && res.status === 200 && knownTotal > 0 && buf.byteLength >= knownTotal) {
                // Server hat Range ignoriert und die KOMPLETTE Datei geliefert → fertig.
                console.warn('[xYT] DL-CHUNK-WARNUNG: Server lieferte Status 200 (kompletter Body) statt 206 — Range ignoriert. Datei wird als Ganzes übernommen.');
                finishDownload();
                return;
              }
              reportProgress();
              if (knownTotal > 0) {
                nextChunk(received); // nächster Chunk ab aktueller Position
              } else if (buf.byteLength < CHUNK_SIZE) {
                finishDownload(); // letzter Chunk bei unbekannter Größe
              } else {
                nextChunk(received);
              }
            } catch (e3) {
              console.warn('[xYT] Chunk-Fehler, Fallback GM_download:', e3);
              fallbackDownload(url, filename);
            }
          },
          onerror: function (err) {
            console.warn('[xYT] Chunk onerror, Fallback GM_download:', err);
            fallbackDownload(url, filename);
          },
          ontimeout: function () {
            console.warn('[xYT] Chunk Timeout, Fallback GM_download');
            fallbackDownload(url, filename);
          }
        });
      } catch (eSync) {
        // v1.0.42: GM_xmlhttpRequest kann auch SYNCHRON werfen (z. B. ungültige
        // URL). Vorher blieb der Download still stehen (kein Fallback). Jetzt
        // sauber in den GM_download-Fallback.
        console.warn('[xYT] Chunk-Request synchron fehlgeschlagen, Fallback GM_download:', eSync);
        fallbackDownload(url, filename);
      }
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
  // -------------------------------------------------------------------------
  function downloadStreamBytes(url, expectedSize, onProgress) {
    return new Promise(function (resolve, reject) {
      const knownTotal = Number(expectedSize) || 0;
      const chunks = [];
      let received = 0;

      function nextChunk(start) {
        const end = knownTotal > 0
          ? Math.min(start + CHUNK_SIZE - 1, knownTotal - 1)
          : (start + CHUNK_SIZE - 1);
        if (knownTotal > 0 && start >= knownTotal) {
          finishOk();
          return;
        }
        try {
          GM_xmlhttpRequest({
            method: 'GET',
            url: String(url),
            headers: { 'Range': 'bytes=' + start + '-' + end },
            responseType: 'arraybuffer',
            timeout: 60000,
            onload: function (res) {
              try {
                const buf = res && res.response;
                if (!buf || !buf.byteLength) throw new Error('leere Chunk-Antwort (Status ' + (res && res.status) + ')');
                chunks.push(buf);
                received += buf.byteLength;
                if (res && res.status === 200 && knownTotal > 0 && buf.byteLength >= knownTotal) {
                  finishOk();
                  return;
                }
                if (onProgress) onProgress(received, knownTotal);
                if (knownTotal > 0) {
                  nextChunk(received);
                } else if (buf.byteLength < CHUNK_SIZE) {
                  finishOk();
                } else {
                  nextChunk(received);
                }
              } catch (e3) {
                reject(e3);
              }
            },
            onerror: function (err) {
              reject(new Error('Chunk onerror: ' + ((err && err.error) || 'unbekannt')));
            },
            ontimeout: function () {
              reject(new Error('Chunk Timeout'));
            }
          });
        } catch (eSync) {
          // v1.0.42: Synchroner Wurf von GM_xmlhttpRequest (z. B. ungültige URL)
          // → Promise ablehnen statt still hängen (runDownload zeigt Fehler).
          reject(eSync);
        }
      }

      function finishOk() {
        try {
          const total = chunks.reduce(function (s, c) { return s + c.byteLength; }, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            out.set(new Uint8Array(c), off);
            off += c.byteLength;
          }
          resolve(out);
        } catch (e4) {
          reject(e4);
        }
      }

      nextChunk(0);
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
    // v1.0.50 BUGFIX: NUR MP4-Audio für den DASH-Merge zulassen — mergeFmp4
    // baut MP4-Boxen (ftyp/moov/moof/mdat) und kann WEBM/Opus (EBML) NICHT
    // verarbeiten. Vorher fiel der Code auf audioOnly zurück, wenn kein
    // MP4-Audio existierte → kaputte Datei („Führe Video + Audio zusammen"
    // mit opus/webm). Jetzt: kein MP4-Audio → null → DASH-Button lädt
    // Video-only ohne Merge (kein Ton, aber gültige Datei).
    if (!Array.isArray(audioOnly) || audioOnly.length === 0) return null;
    const mp4 = audioOnly.filter(function (s) { return (s.mime || '').indexOf('audio/mp4') === 0; });
    if (mp4.length === 0) return null; // kein MP4-Audio → kein Merge möglich
    // Höchste Bitrate zuerst (extractStreams sortiert schon, hier zusätzlich sichern)
    mp4.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
    return mp4[0] || null;
  }

  // -------------------------------------------------------------------------
  // API-Transport (GM_xmlhttpRequest umgeht CORS)
  // -------------------------------------------------------------------------
  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return String(url).slice(0, 60); }
  }

  function gmFetch(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; reject(new Error('Timeout: ' + hostOf(url))); }
      }, timeoutMs || 30000);
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: String(url),
          timeout: timeoutMs || 30000,
          onload: (res) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (res.status >= 200 && res.status < 300) {
              resolve(res.responseText);
            } else {
              reject(new Error('HTTP ' + res.status + ' von ' + hostOf(url)));
            }
          },
          onerror: (err) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(new Error('Netzwerkfehler bei ' + hostOf(url) + (err && err.error ? ' — ' + err.error : '')));
          },
          ontimeout: () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            reject(new Error('Timeout bei ' + hostOf(url)));
          },
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  async function gmFetchJson(url, timeoutMs) {
    const text = await gmFetch(url, timeoutMs);
    return JSON.parse(text);
  }

  // -------------------------------------------------------------------------
  // ANDROID_VR-Innertube-Client (primärer Pfad — Methode von JDownloader2)
  // POST /youtubei/v1/player mit exakt denselben Headern/Client-Config wie JD2
  // (siehe ANALYSE_JD2_YOUTUBE.md). Antwort enthält direkte signierte
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

  function fetchAndroidVrPlayer(videoId) {
    return new Promise(function (resolve, reject) {
      // Exakt JD2-Body (siehe Log): contentPlaybackContext mit html5Preferences +
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
        GM_xmlhttpRequest({
          method: 'POST',
          url: YT_PLAYER_ENDPOINT,
          headers: headers,
          data: body,
          timeout: 30000,
          onload: function (res) {
            try {
              const j = JSON.parse(res.responseText);
              const status = j && j.playabilityStatus && j.playabilityStatus.status;
              if (status && status !== 'OK') {
                reject(new Error('YouTube-Status: ' + status + (j.playabilityStatus.reason ? ' — ' + j.playabilityStatus.reason : '')));
                return;
              }
              if (!j || !j.streamingData) {
                reject(new Error('Keine streamingData in ANDROID_VR-Antwort'));
                return;
              }
              resolve(j);
            } catch (e) {
              reject(new Error('ANDROID_VR-Antwort nicht parsebar: ' + e.message));
            }
          },
          onerror: function (err) {
            reject(new Error('ANDROID_VR-Netzwerkfehler: ' + ((err && err.error) || 'unbekannt')));
          },
          ontimeout: function () {
            reject(new Error('ANDROID_VR-Request Timeout (30 s)'));
          }
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
  // (analog JDownloader2: progressive direkt, Video-only/Audio-only getrennt)
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
        srcArray: srcArray || '?'   // DIAGNOSE: formats (progressiv) oder adaptiveFormats (DASH)
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
    function codecRank(codec) {
      const c = String(codec || '').toLowerCase();
      if (c.indexOf('avc1') === 0 || c.indexOf('avc3') === 0) return 0; // H.264
      if (c.indexOf('vp9') === 0) return 1;                              // VP9
      if (c.indexOf('av01') === 0) return 2;                             // AV1
      return 3;                                                          // unbekannt/sonst
    }
    {
      const best = new Map();
      for (const s of videoOnly) {
        const h = s.height || 0;
        const prev = best.get(h);
        if (!prev || codecRank(s.codec) < codecRank(prev.codec)) best.set(h, s);
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
        if (!prev || codecRank(s.codec) < codecRank(prev.codec)) byRes.set(res, s);
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
  // DEAKTIVIERTER FALLBACK-PFAD: savenow.to / dubs.io (externe Download-API)
  // Wird seit v1.0.19 NICHT mehr aufgerufen — primärer Pfad ist der
  // ANDROID_VR-Innertube-Client (direkte googlevideo-Stream-URLs).
  // Der Code bleibt als Fallback erhalten (nicht gelöscht), falls die direkte
  // Methode eines Tages scheitert (z. B. YouTube blockt ANDROID_VR).
  // -------------------------------------------------------------------------
  async function startSaveNow(videoUrl, format) {
    let lastErr = null;
    for (const base of SAVENOW_BASES) {
      try {
        const u = new URL('/ajax/download.php', base);
        u.searchParams.set('copyright', '0');
        u.searchParams.set('allow_extended_duration', '1');
        u.searchParams.set('format', String(format));
        u.searchParams.set('url', videoUrl);
        u.searchParams.set('api', API_KEY);
        const data = await gmFetchJson(u.toString(), 30000);
        if (data && data.success && data.progress_url) {
          return { provider: 'savenow', progressUrl: data.progress_url, title: data.title || (data.info && data.info.title) || '' };
        }
        lastErr = new Error('savenow.to: kein success/progress_url');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('savenow.to nicht verfügbar');
  }

  // dubs.io akzeptiert nur diese Formate (real getestet 2026-08-04);
  // andere Werte (144/240/4k/8k/ogg/flac/wav) liefern 'Not available format'.
  const DUBS_SUPPORTED = new Set(['360', '480', '720', '1080', 'mp3', 'm4a', 'aac', 'opus', 'webm']);

  async function startDubs(videoId, format) {
    if (!DUBS_SUPPORTED.has(String(format))) {
      throw new Error('dubs.io unterstützt Format ' + format + ' nicht (nur 360/480/720/1080, Audio mp3/m4a/aac/opus/webm)');
    }
    const u = new URL(DUBS_START);
    u.searchParams.set('id', videoId);
    u.searchParams.set('format', String(format));
    const data = await gmFetchJson(u.toString(), 30000);
    if (!data || !data.success || !data.progressId) {
      throw new Error('dubs.io: kein success/progressId');
    }
    return { provider: 'dubs', progressId: data.progressId };
  }

  // Pollt bis fertig; ruft onProgress(0..100) auf. Liefert download_url.
  // Sicherheitsnetz: bricht ab, wenn der Fortschritt 120 s lang nicht steigt
  // (Server-Job hängt) — statt den Nutzer endlos auf „Vorbereitung: 5 %"
  // starren zu lassen.
  async function pollUntilDone(job, onProgress) {
    const STUCK_MS = 120000;
    let lastPct = -1;
    let lastChange = Date.now();

    const report = (rawPct, apiText) => {
      const pct = Math.min(Number(rawPct) || 0, 1000);
      if (pct !== lastPct) { lastPct = pct; lastChange = Date.now(); }
      onProgress(pct / 10, apiText || '');
      if (Date.now() - lastChange > STUCK_MS) {
        throw new Error('Kein Fortschritt seit 120 s — der Download-Dienst hängt gerade. Fenster schließen und erneut versuchen.');
      }
    };

    if (job.provider === 'savenow') {
      while (true) {
        const d = await gmFetchJson(job.progressUrl, 30000);
        report(Number(d.progress) || 0, d.text);
        if (Number(d.progress) >= 1000 && d.download_url) return d.download_url;
        if (d.success === 0 && d.error) throw new Error(d.error);
        await sleep(3000);
      }
    }
    // dubs.io
    const statusUrl = new URL(DUBS_STATUS);
    statusUrl.searchParams.set('id', job.progressId);
    while (true) {
      const d = await gmFetchJson(statusUrl.toString(), 30000);
      report(Number(d.progress) || 0, d.text);
      if (d.finished && d.downloadUrl) return d.downloadUrl;
      await sleep(3000);
    }
  }

  async function startDownload(videoUrl, videoId, format, onProgress) {
    let job = null;
    let lastErr = null;
    try {
      job = await startSaveNow(videoUrl, format);
    } catch (e) {
      lastErr = e;
      try {
        job = await startDubs(videoId, format);
      } catch (e2) {
        throw new Error('Beide Download-Anbieter fehlgeschlagen: ' + (lastErr && lastErr.message) + ' | ' + (e2 && e2.message));
      }
    }
    return pollUntilDone(job, onProgress);
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
        renderPanelMessage('Keine direkten Streams in der Antwort — Video evtl. nicht verfügbar (age-restricted/Livestream?).', true);
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
          + ' | mime=' + ((u.match(/mime=([^&]*)/) || [])[1] || '?')
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
        const vPromise = downloadStreamBytes(stream.url, stream.size, function (received) { vRecv = received; reportMerge(); });
        const aPromise = downloadStreamBytes(mergeAudio.url, mergeAudio.size, function (received) { aRecv = received; reportMerge(); });
        const vBytes = await vPromise;
        const aBytes = await aPromise;
        setStatusText('Führe Video + Audio zusammen …');
        dbg('[xYT] MERGE-LADEN-FERTIG: Video=' + vBytes.length + ' B, Audio=' + aBytes.length + ' B');
        const merged = mergeFmp4(vBytes, aBytes);
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
    if (!/\/(watch|shorts)/.test(window.location.pathname)) {
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
    if (/\/(watch|shorts)/.test(window.location.pathname)) {
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
          if (/\/(watch|shorts)/.test(window.location.pathname) && getVideoId()) {
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
