// ==UserScript==
// @name         xYTDownloader
// @namespace    local:xyt-downloader
// @version      1.1.16
// @description One-click YouTube downloader for /watch, /shorts and /live: up to 4K with audio, DASH merge, live progress, cancel and retry. No third-party download services; direct VISIONOS client.
// @description:de YouTube-Downloader für /watch, /shorts und /live: bis 4K mit Ton, DASH-Merge, Live-Fortschritt, Abbrechen und erneut versuchen. Keine Download-Dienste von Drittanbietern, direkter VISIONOS-Client.
// @description:ru Скачивание YouTube для /watch, /shorts и /live: до 4K со звуком, объединение DASH, прогресс в реальном времени, отмена и повтор. Без сторонних сервисов загрузки, прямой клиент VISIONOS.
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
// @downloadURL  https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js
// @updateURL    https://update.greasyfork.org/scripts/589972/xYTDownloader.meta.js
// ==/UserScript==

// v1.0.99: Die Update-Adressen stehen jetzt DIREKT im Metablock. In v1.0.98
// lagen Kommentarzeilen zwischen den @-Einträgen — Tampermonkey übernahm
// Die beiden Update-Zeilen dadurch nicht (im Dashboard fehlte der Update-Pfeil).

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
  const MY_VERSION = '1.1.16';
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

  // -------------------------------------------------------------------------
  // Kleine Helfer
  // -------------------------------------------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);

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
  // v1.1.04: EINE zentrale Verzögerung (PANEL_AUTOCLOSE_MS = 1000 ms) statt mehrerer
  // Zeitwerte, plus Token gegen veraltete Timer: Ein Timer darf nur das Panel
  // schließen, das zu seinem Download gehörte — nicht ein inzwischen neu
  // geöffnetes Panel oder einen neu gestarteten Download. invalidatePanelClose()
  // macht alle laufenden Schließ-Timer ungültig.
  const PANEL_AUTOCLOSE_MS = 1000; // v1.1.04: 1 s statt 500 ms
  let panelCloseToken = 0;
  function invalidatePanelClose() {
    panelCloseToken++;
  }
  function autoClosePanelAfter(delayMs) {
    const myToken = ++panelCloseToken;
    const delay = (typeof delayMs === 'number' && delayMs >= 0) ? delayMs : PANEL_AUTOCLOSE_MS;
    setTimeout(function () {
      if (myToken !== panelCloseToken) return; // veralteter Timer — ignorieren
      try {
        const p = document.getElementById('xyt-dl-panel');
        if (p) p.style.display = 'none';
      } catch (e) { /* ignore */ }
    }, delay);
  }

  // Statusanzeige im Panel aktualisieren (gemeinsamer Helfer)
  // v1.0.42: panelStatusEl/panelBarEl/panelFillEl werden beim Panel-Aufbau
  // gecacht (renderPanel* / runDownload) — kein querySelector je Fortschritts-
  // Update (spart Reflow bei jedem Chunk). Fallback: querySelector, falls das
  // Panel zwischenzeitlich neu gebaut wurde (Cache veraltet).
  let panelStatusEl = null, panelBarEl = null, panelFillEl = null;
  // v1.0.94: Schutz gegen veraltete Formatanfragen — jede Anfrage bekommt eine
  // Sequenznummer; nur die jeweils aktuelle darf das Panel noch verändern.
  // playerAbort bricht die laufende Anfrage ab (Video-Wechsel, Panel zu, Retry).
  let loadSeq = 0;
  let playerAbort = null;
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

  // -------------------------------------------------------------------------
  // v1.0.98: Download-Steuerung (Abbruch) und Fortschrittsrechnung.
  // Phase (Video/Audio/Merge/Abschluss), geladene/gesamte Menge, Geschwindigkeit
  // (gleitendes ~2-s-Fenster) und Restzeit. DOM wird auf max. ~4 Updates/s
  // gedrosselt — wichtig, weil der MutationObserver sonst bei jedem Chunk feuert.
  // -------------------------------------------------------------------------
  let dlAbort = null;       // AbortController des LAUFENDEN Downloads
  let dlCancelled = false;  // true = Nutzer hat abgebrochen
  let dlPhase = '';
  let dlLastUpdate = 0;
  const dlSamples = [];     // {t, b} für die Geschwindigkeit

  function resetProgress(phase) {
    dlPhase = phase || '';
    dlLastUpdate = 0;
    dlSamples.length = 0;
  }
  function fmtDuration(sec) {
    if (!isFinite(sec) || sec <= 0) return '—';
    if (sec < 60) return Math.ceil(sec) + ' s';
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + ' min ' + s + ' s';
  }
  // total 0 = unbekannt; speed 0 = noch keine Messung (wird als „…" gezeigt)
  function updateProgress(phase, received, total) {
    // v1.0.98: Nach dem Abbruch darf kein laufender Chunk den Status wieder
    // überschreiben (Race zwischen Abort und letztem Fortschritts-Update).
    if (dlCancelled) return;
    const now = Date.now();
    if (now - dlLastUpdate < 250) return;   // Drossel
    dlLastUpdate = now;
    if (phase) dlPhase = phase;
    dlSamples.push({ t: now, b: received });
    while (dlSamples.length > 1 && now - dlSamples[0].t > 2000) dlSamples.shift();
    let speed = 0;
    if (dlSamples.length >= 2) {
      const a = dlSamples[0], z = dlSamples[dlSamples.length - 1];
      const dt = (z.t - a.t) / 1000;
      if (dt > 0.2) speed = (z.b - a.b) / dt;
    }
    const hasTotal = total > 0;
    const pct = hasTotal ? Math.max(0, Math.min(100, Math.round((received / total) * 100))) : 0;
    const parts = [];
    if (dlPhase) parts.push(dlPhase);
    parts.push(hasTotal ? (pct + ' %') : '…');
    parts.push(hasTotal ? (formatBytes(received) + ' / ' + formatBytes(total)) : ('>' + formatBytes(received)));
    parts.push(speed > 0 ? (formatBytes(speed) + '/s') : '…/s');
    parts.push('Rest ' + (hasTotal && speed > 0 ? fmtDuration((total - received) / speed) : '—'));
    setBarProgress(hasTotal ? pct : Math.min(99, Math.max(3, Math.round((received / Math.max(received + CHUNK_SIZE, 1)) * 100))));
    setStatusText(parts.join(' · '));
    dbg('[xYT] PROGRESS: phase=' + dlPhase + ' received=' + received + ' total=' + total + ' speed=' + Math.round(speed) + ' B/s');
  }

  // v1.0.98: bricht den laufenden Download ab. Kein Blob, keine Datei.
  function cancelDownload() {
    if (!running) {
      // v1.1.13: Kein Download aktiv (z. B. Größenwarnung, Fehler, fertiger
      // Lauf) — „Abbrechen" muss trotzdem reagieren und das Panel schließen.
      dbg('[xYT] CANCEL: kein laufender Download — Panel wird geschlossen');
      hidePanel();
      return;
    }
    dlCancelled = true;
    dbg('[xYT] CANCEL: Nutzer hat abgebrochen (Phase ' + dlPhase + ')');
    if (dlAbort) { try { dlAbort.abort(); } catch (e) { /* ignore */ } }
    setBarProgress(0);
    setStatusText('Download abgebrochen (' + (dlPhase || 'Download') + ') — keine Datei gespeichert.');
  }

  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    // v1.1.15: Die Object-URL darf bei GROSSEN Dateien NICHT nach 4 s freigegeben
    // werden. Chrome kopiert den Blob minutenlang in den Downloadordner; ein
    // frühes revokeObjectURL bricht den Transfer ab und hinterlässt eine
    // .crdownload-Datei. Kleine Downloads (<= 100 MB) werden weiter aufgeräumt.
    const big = (typeof blob.size === 'number' && blob.size > 100 * 1024 * 1024);
    if (big) {
      setTimeout(function () { try { a.remove(); } catch (e) { /* ignore */ } }, 4000);
      dbg('[xYT] saveBlob: große Datei (' + blob.size + ' B) — Object-URL bleibt bis zum Seitenwechsel gültig.');
    } else {
      setTimeout(function () {
        try { URL.revokeObjectURL(objectUrl); a.remove(); } catch (e) { /* ignore */ }
      }, 4000);
    }
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
  // v1.1.12: Chromium kann keinen ArrayBuffer über ~2 GB allokieren
  // („Array buffer allocation failed" nach dem KOMPLETTEN Download, z. B. bei
  // 2160p mit 2,85 GB). Deshalb vor dem Start prüfen und klar melden, statt
  // 2,85 GB zu laden und dann zu scheitern. 1,9 GB lässt Sicherheitsabstand.
  const MAX_BUFFER_BYTES = 1900 * 1024 * 1024;
  function fmtGB(bytes) {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // v1.0.72: Range-Chunk per native window.fetch geladen. Die Range wird als
  // `&range=START-END` DIREKT in die Stream-URL geschrieben — so lädt der
  // Stream Audio itag 140 und Video itag 401 komplett per `&range=` +
  // `&ratebypass=yes`. v1.0.91: bewusst OHNE Custom-Header (siehe unten) — die
  // signierte URL trägt alles Nötige. Liefert {status, bytes, ok, headers, err}.
  function fetchRangeChunk(url, start, end, signal) {
    let u = String(url);
    if (!/range=/i.test(u)) {
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'range=' + start + '-' + end;
    }
    if (!/ratebypass=/i.test(u)) {
      u += '&ratebypass=yes';
    }
    // v1.0.91: KEINE Custom-Header mehr — Firefox-Fix (2026-09-19).
    // Ursache: 'User-Agent' ist seit Firefox 43 NICHT mehr forbidden und wird in
    // Firefox tatsächlich gesendet. Als Nicht-Safelisted Header erzwingt er einen
    // CORS-Preflight, den googlevideo ablehnt (Access-Control-Allow-Headers führt
    // 'Range', aber kein 'User-Agent') → fetch wirft TypeError → Status 0
    // („leere Chunk-Antwort (Status 0)"). Chromium verwirft den UA-Header still
    // (crbug 571722) — deshalb fiel es in Yandex/Chrome nie auf. 'Referer' und
    // 'Accept-Encoding' sind in beiden Browsern forbidden und kamen nie an.
    // Die signierte URL trägt alle nötigen Parameter (&range=/&ratebypass=).
    return fetch(u, signal ? { signal: signal } : undefined).then(function (res) {
      if (!res.ok) return { status: res.status, bytes: null, ok: false, headers: res.headers };
      return res.arrayBuffer().then(function (ab) {
        return { status: res.status, bytes: ab, ok: true, headers: res.headers };
      });
    }).catch(function (err) {
      // v1.0.98: Nutzer-Abbruch getrennt kennzeichnen (kein Retry, kein Fallback).
      if (err && err.name === 'AbortError') {
        return { status: 0, bytes: null, ok: false, aborted: true, err: err, headers: null };
      }
      // v1.0.91: Ursache sichtbar machen (Netzwerk/CORS/Blocker) — wurde vorher
      // verschluckt; im Panel stand nur „Status 0" ohne jeden Anhaltspunkt.
      console.warn('[xYT] fetch fehlgeschlagen (Netzwerk/CORS/Erweiterung?): ' + (err && err.message ? err.message : String(err)));
      return { status: 0, bytes: null, ok: false, err: err, headers: null };
    });
  }

  function downloadUrl(url, filename, expectedSize, signal) {
    // v1.1.05: liefert ein Promise. Vorher wurde der Download nur GESTARTET und
    // runDownload setzte `running` sofort zurück — ein Abbruch/Neustart konnte
    // dadurch parallel zu einem laufenden Transfer erfolgen.
    return new Promise(function (doneDownload) {
    let knownTotal = Number(expectedSize) || 0;   // v1.0.38: let, damit die Probe die Größe nachtragen kann
    // B3-Fix (2026-10-17): KEIN GM_xmlhttpRequest-Gate mehr. Der Download läuft
    // vollständig über natives fetch (fetchRangeChunk); die API wird nirgends
    // aufgerufen. Das alte Gate schickte GM-lose Umgebungen (z. B. Via) still in
    // fallbackDownload (GM_download/window.open) — also in einen toten Pfad.
    const chunks = [];
    let received = 0;
    let probed = false; // v1.0.38: nur EINE Größen-Probe pro Download
    let netTries = 0;   // B2-Fix: begrenzte Wiederholungen bei temporären Fehlern
    const MAX_NET_TRIES = 3;

    function reportProgress() {
      // v1.0.98: zentrale Fortschrittsanzeige (Phase · Menge · Tempo · Restzeit),
      // gedrosselt in updateProgress(); bei unbekannter Größe wächst der Balken
      // weiterhin statisch statt zu springen.
      updateProgress('Video', received, knownTotal);
    }

    // v1.0.38: Bei unbekannter Größe (progressive Formate liefern in der
    // VISIONOS-Antwort kein contentLength) einmalig die Dateigröße per
    // Range-Probe (bytes=0-0) ermitteln — wie in v1.0.12–v1.0.15. Der
    // Content-Range-Header liefert die Gesamtgröße → Balken 0–100 % wie beim
    // DASH/Merge-Pfad. Schlägt die Probe fehl, läuft der alte Pfad weiter
    // (Balken wächst statisch, s. reportProgress-else).
    function probeSize() {
      if (probed || knownTotal > 0) { nextChunk(0); return; }
      probed = true;
      // v1.0.71: native fetch (konsistent mit den Chunks; kein 403 in der Sandbox).
      fetchRangeChunk(url, 0, 0, signal).then(function (r) {
        if (r.aborted) {
          // v1.1.08: Abbruch waehrend der Groessen-Probe darf das Promise NICHT
          // offen lassen (vorher: `return` ohne doneDownload).
          setStatusText('Download abgebrochen — keine Datei gespeichert.');
          doneDownload({ ok: false, aborted: true });
          return;
        }
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
      fetchRangeChunk(url, start, end, signal).then(function (r) {
        if (r.aborted) { const e = new Error('Abgebrochen'); e.aborted = true; throw e; }
        if (!r.ok || !r.bytes) {
          throw new Error('leere Chunk-Antwort (Status ' + r.status + ')');
        }
        const buf = r.bytes;
        // v1.1.06: Bei 206 muss der gelieferte Bytebereich EXAKT zur angefragten
        // Range passen. Ein zu kurzer/falscher Chunk würde sonst als vollständig
        // gelten und die Datei stillschweigend verstümmeln.
        if (r.status === 206) {
          // v1.1.07: Content-Range vollständig prüfen — Start, Ende und
          // Gesamtgröße. Nur so kann ein verschobener/falscher Bereich nicht
          // unbemerkt in die Datei wandern.
          let crRaw = '';
          try { crRaw = r.headers && r.headers.get ? String(r.headers.get('content-range') || '') : ''; } catch (e) { /* ignore */ }
          const mcr = crRaw.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
          if (!mcr) {
            throw new Error('unvollständiger Chunk: 206 ohne gültigen Content-Range-Header ("' + crRaw.slice(0, 40) + '")');
          }
          const crStart = Number(mcr[1]);
          const crEnd = Number(mcr[2]);
          const crTotal = (mcr[3] === '*') ? null : Number(mcr[3]);
          const problems = [];
          // Erwartete Länge: bei bekannter Gesamtgröße exakt die Range, sonst
          // höchstens die Range (der letzte Chunk darf kürzer sein).
          if (knownTotal > 0) {
            if (buf.byteLength !== (end - start + 1)) problems.push('Länge ' + buf.byteLength + ' statt ' + (end - start + 1));
          } else if (buf.byteLength <= 0 || buf.byteLength > (end - start + 1)) {
            problems.push('Länge ' + buf.byteLength + ' außerhalb 1..' + (end - start + 1));
          }
          if (crStart !== start) problems.push('Start ' + crStart + ' statt ' + start);
          if (crEnd !== (start + buf.byteLength - 1)) problems.push('Ende ' + crEnd + ' statt ' + (start + buf.byteLength - 1));
          if (crTotal !== null && knownTotal > 0 && crTotal !== knownTotal) problems.push('Gesamtgröße ' + crTotal + ' statt ' + knownTotal);
          if (problems.length) {
            throw new Error('unvollständiger Chunk: ' + problems.join('; '));
          }
        }
        const prev = received;
        chunks.push(buf);
        received += buf.byteLength;
        // DIAGNOSE: Was kam real zurück? Status 206 = Range ok, 200 = kompletter Body!
        dbg('[xYT] DL-CHUNK-OK: Status=' + r.status + ' | angefordert=' + (end - start + 1) + ' B | erhalten=' + buf.byteLength + ' B | received-gesamt=' + received);
        // v1.1.05: Status 200 bedeutet, dass der Server die Range-Anfrage
        // IGNORIERT und den KOMPLETTEN Body geschickt hat. Das darf nur
        // akzeptiert werden, wenn wir am Dateianfang stehen und die Größe
        // stimmt — sonst würden Daten doppelt angehängt und stillschweigend als
        // erfolgreicher Download gespeichert. Lieber laut scheitern.
        if (r.status === 200) {
          const sizeOk = (knownTotal > 0) ? (buf.byteLength === knownTotal) : true;
          if (start !== 0 || !sizeOk) {
            console.warn('[xYT] DL-ABBRUCH: HTTP 200 trotz Range (start=' + start + ', erhalten=' + buf.byteLength + ' B, knownTotal=' + knownTotal + ') — Daten verworfen, kein Doppel-Speichern.');
            chunks.pop();
            received = prev;
            setStatusText('Download fehlgeschlagen: Server ignorierte die Range-Anfrage (HTTP 200) — Daten verworfen.');
            doneDownload({ ok: false, error: 'HTTP 200 statt 206 (Range ignoriert)' });
            return;
          }
          if (knownTotal === 0) knownTotal = buf.byteLength;
          console.warn('[xYT] DL-CHUNK-WARNUNG: Status 200 (kompletter Body statt 206) — Datei vollständig geliefert, Range ignoriert.');
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
        // v1.0.98: Abbruch hat Vorrang — keine Retries, kein GM-Fallback.
        if (dlCancelled || (e3 && e3.aborted) || /Abgebrochen/.test(String((e3 && e3.message) || e3))) {
          dbg('[xYT] DL-CANCEL: abgebrochen bei Byte ' + received);
          setStatusText('Download abgebrochen — keine Datei gespeichert.');
          doneDownload({ ok: false, aborted: true });
          return;
        }
        // B2-Fix (2026-10-17): Temporäre Fehler (Netzabbruch/Status 0, 5xx, 429)
        // werden begrenzt wiederholt, bevor der GM-Fallback greift. Der Chunk wird
        // dabei NICHT gepusht (received/chunks unverändert) → keine doppelten Daten,
        // der Balken bleibt stehen statt zu springen.
        const msg = String((e3 && e3.message) || e3);
        // v1.1.06: Ein unvollständiger/falscher Bytebereich ist ein DATENFEHLER,
        // kein Netzwerk-Wackler — er darf nicht in den GM/window.open-Fallback
        // laufen (der würde eine andere, ungeprüfte Datei laden).
        const permanent = /Status (403|404|416)\b/.test(msg) || /unvollständiger Chunk/.test(msg);
        if (!permanent && netTries < MAX_NET_TRIES) {
          netTries++;
          const delay = Math.min(8000, 1000 * Math.pow(2, netTries - 1));
          dbg('[xYT] DL-TRANSIENT: ' + msg + ' — Versuch ' + netTries + '/' + MAX_NET_TRIES + ' in ' + delay + ' ms');
          setStatusText('Netzwerkfehler — neuer Versuch ' + netTries + '/' + MAX_NET_TRIES + ' …');
          setTimeout(function () {
            // v1.1.06: Ein ausstehender Retry darf nach einem Abbruch keinen
            // verspäteten Download mehr starten.
            if (dlCancelled) {
              dbg('[xYT] DL-CANCEL: ausstehender Retry verworfen');
              doneDownload({ ok: false, aborted: true });
              return;
            }
            nextChunk(start);
          }, delay);
          return;
        }
        // v1.1.06: Ein unvollständiger Bytebereich ist ein Datenfehler des
        // Servers. Ein Browser-Fallback würde eine ANDERE, ungeprüfte Datei
        // laden — deshalb hier bewusst kein Fallback, sondern klarer Fehler.
        if (/unvollständiger Chunk/.test(msg)) {
          console.warn('[xYT] Chunk-Datenfehler (' + msg + ') — kein Browser-Fallback.');
          setStatusText('Download fehlgeschlagen: ' + msg + ' — keine Datei gespeichert.');
          doneDownload({ ok: false, error: msg });
          return;
        }
        console.warn('[xYT] Chunk-Fehler (' + msg + '), Fallback GM_download:', e3);
        setStatusText('Download fehlgeschlagen (' + msg + ') — versuche Browser-Download …');
        fallbackDownload(url, filename, function (resFb) { doneDownload(resFb); });
      });
    }

    function finishDownload() {
      try {
        // v1.1.12: Blob-Grenze früh prüfen (gleiche Grenze wie beim Merge).
        let sum = 0;
        for (const c of chunks) sum += c.byteLength;
        if (sum > MAX_BUFFER_BYTES) {
          setStatusText('Zu groß für den Browser: ' + fmtGB(sum) + ' (Grenze ' + fmtGB(MAX_BUFFER_BYTES) + ') — bitte eine niedrigere Qualität wählen.');
          doneDownload({ ok: false, error: 'Datei zu groß für den Browser (' + fmtGB(sum) + ')' });
          return;
        }
        const blob = new Blob(chunks, { type: 'application/octet-stream' });
        setBarProgress(100);
        // v1.1.05: Daten sind geladen, das Speichern ist ANGESTOSSEN — der
        // Browser bestätigt es nicht. Deshalb keine „abgeschlossen"-Behauptung.
        setStatusText('Daten vollständig geladen (' + formatBytes(blob.size) + ') — Speichern angestoßen: ' + filename);
        dbg('[xYT] DL-FERTIG: byteLength=' + blob.size + ' expectedSize=' + knownTotal + ' | Chunks=' + chunks.length);
        if (knownTotal > 0) {
          const dev = Math.abs(blob.size - knownTotal) / knownTotal;
          dbg('[xYT] Größencheck: erwartet=' + knownTotal + ' B, tatsächlich=' + blob.size + ' B, Abweichung=' + (dev * 100).toFixed(2) + ' %');
        }
        saveBlob(blob, filename);
        doneDownload({ ok: true, bytes: blob.size, confirmed: false });
        autoClosePanelAfter();
      } catch (e4) {
        console.warn('[xYT] Zusammenfügen fehlgeschlagen, Fallback GM_download:', e4);
        // v1.1.08: vorher ohne Callback → das Promise blieb bei einem Fehler im
        // Speicher-/Fallback-Pfad dauerhaft offen.
        fallbackDownload(url, filename, function (resFb2) { doneDownload(resFb2); });
      }
    }

    // v1.0.38: Bei unbekannter Größe erst proben, dann Chunks; sonst direkt.
    if (knownTotal > 0) {
      nextChunk(0);
    } else {
      probeSize();
    }
    }); // new Promise (v1.1.05)
  }


  // Fallback: GM_download (falls Blob nicht klappt), zuletzt window.open.
  // v1.1.05: `onDone` meldet den TATSÄCHLICHEN Ausgang an downloadUrl zurück —
  // ein angestoßenes window.open gilt ausdrücklich NICHT als bestätigter Abschluss.
  function fallbackDownload(url, filename, onDone) {
    const done = (typeof onDone === 'function') ? onDone : function () {};
    if (typeof GM_download === 'function') {
      try {
        GM_download({
          url: String(url),
          name: filename,
          saveAs: false,
          onload: function () {
            setBarProgress(100);
            // GM_download bestätigt nur, dass der Downloadvorgang endete —
            // nicht, dass die Datei im Dateisystem liegt.
            setStatusText('Browser-Download abgeschlossen (nicht bestätigt): ' + filename);
            done({ ok: true, bytes: 0, confirmed: false, fallback: true });
            autoClosePanelAfter();
          },
          onerror: function (err) {
            setStatusText('Download fehlgeschlagen: ' + ((err && err.error) || 'unbekannter Fehler'));
            done({ ok: false, error: String((err && err.error) || 'GM_download-Fehler') });
          }
        });
        return;
      } catch (e) {
        console.warn('[xYT] GM_download fehlgeschlagen, Fallback window.open:', e);
      }
    }
    try {
      // v1.1.03: window.open liefert KEINE Bestätigung, dass die Datei wirklich
      // gespeichert wurde (Popup-Blocker, abgebrochener Tab). Deshalb hier
      // bewusst KEIN Auto-Schließen — das Panel bleibt mit der Meldung stehen.
      window.open(url);
      setStatusText('Browser-Download angestoßen (unbestätigt) — Datei im Download-Ordner prüfen.');
      done({ ok: false, error: 'window.open ohne Bestätigung', unconfirmed: true });
    } catch (e) {
      done({ ok: false, error: 'window.open fehlgeschlagen' });
    }
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
  function downloadStreamBytes(url, expectedSize, onProgress, refreshInfo, initRange, signal) {
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
      // B2-Fix (2026-10-17): begrenzte Wiederholungen für TEMPORÄRE Fehler
      // (Status 0 = fetch geworfen/Netzabbruch, 429 Rate-Limit, 5xx Gateway).
      // Permanente Fehler (403/404/416, alles andere) werden NICHT wiederholt.
      let netTries = 0;
      const MAX_NET_TRIES = 4;
      function isTransientStatus(s) {
        return s === 0 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
      }
      function retryChunk(start, status, why) {
        if (netTries >= MAX_NET_TRIES) {
          throw new Error('Download abgebrochen nach ' + MAX_NET_TRIES + ' Netzwerkversuchen (Status ' + status + ')' + why);
        }
        netTries++;
        const delay = Math.min(8000, 1000 * Math.pow(2, netTries - 1));
        dbg('[xYT] TRANSIENT (Status ' + status + why + ') — Versuch ' + netTries + '/' + MAX_NET_TRIES + ' in ' + delay + ' ms ab Byte ' + start);
        setStatusText('Netzwerkfehler — neuer Versuch ' + netTries + '/' + MAX_NET_TRIES + ' (' + Math.round(delay / 1000) + ' s) …');
        return new Promise(function (res) { setTimeout(res, delay); }).then(function () {
          // Status 0/429: frische signierte URL kann helfen (abgelaufene Signatur,
          // Rate-Limit). Schlägt der Refresh fehl, läuft es mit der alten URL weiter.
          if (status === 0 || status === 429) {
            return refreshUrl().then(function () { nextChunk(start); });
          }
          nextChunk(start);
        });
      }
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
        fetchRangeChunk(currentUrl, start, end, signal).then(function (r) {
          if (r.aborted) { const e = new Error('Abgebrochen'); e.aborted = true; reject(e); return; }
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
        }).catch(reject); // v1.1.08: Fehler darf das Promise nicht offen lassen
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
        fetchRangeChunk(currentUrl, start, end, signal).then(function (r) {
          if (r.aborted) { const e = new Error('Abgebrochen'); e.aborted = true; reject(e); return; }
          // v1.0.72: 403 → frische URL holen und ab `start` nochmal versuchen.
          if (!r.ok || !r.bytes) {
            // v1.0.91: Ursache aus dem fetch-Fehler in die Meldung übernehmen
            // (Status 0 = Netzwerk-/CORS-Abbruch, z. B. durch Erweiterungen).
            const why = r.err ? ' — ' + (r.err && r.err.message ? r.err.message : String(r.err)) : '';
            if (r.status === 403 || r.status === 416) {
              return refreshUrl().then(function (ok) {
                if (ok) { nextChunk(start); return; }
                throw new Error('leere Chunk-Antwort (Status ' + r.status + ')' + why);
              });
            }
            // B2-Fix: temporäre Fehler begrenzt wiederholen (Status 0/429/5xx).
            if (isTransientStatus(r.status)) {
              return retryChunk(start, r.status, why);
            }
            throw new Error('leere Chunk-Antwort (Status ' + r.status + ')' + why);
          }
          const buf = r.bytes;
          // v1.1.08: Der DASH-Pfad bekommt dieselbe 206-Integritätsprüfung wie
          // der progressive Pfad — sonst könnten verschobene oder zu kurze
          // Bereiche unbemerkt in die gemergte Datei wandern.
          if (r.status === 206) {
            let crRaw = '';
            try { crRaw = r.headers && r.headers.get ? String(r.headers.get('content-range') || '') : ''; } catch (e) { /* ignore */ }
            const mcr = crRaw.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
            if (!mcr) throw new Error('unvollständiger Chunk: 206 ohne gültigen Content-Range-Header');
            const crStart = Number(mcr[1]);
            const crEnd = Number(mcr[2]);
            const crTotal = (mcr[3] === '*') ? null : Number(mcr[3]);
            const problems = [];
            if (knownTotal > 0) {
              if (buf.byteLength !== (end - start + 1)) problems.push('Länge ' + buf.byteLength + ' statt ' + (end - start + 1));
            } else if (buf.byteLength <= 0 || buf.byteLength > (end - start + 1)) {
              problems.push('Länge ' + buf.byteLength + ' außerhalb 1..' + (end - start + 1));
            }
            if (crStart !== start) problems.push('Start ' + crStart + ' statt ' + start);
            if (crEnd !== (start + buf.byteLength - 1)) problems.push('Ende ' + crEnd + ' statt ' + (start + buf.byteLength - 1));
            if (crTotal !== null && knownTotal > 0 && crTotal !== knownTotal) problems.push('Gesamtgröße ' + crTotal + ' statt ' + knownTotal);
            if (problems.length) throw new Error('unvollständiger Chunk: ' + problems.join('; '));
          }
          if (r.status === 200) {
            // v1.1.10: HTTP 200 hat ZWEI verschiedene Bedeutungen — beide sind
            // kein Fehler und dürfen nicht verworfen werden:
            // (a) Body = GESAMTE Datei (Range ignoriert, z. B. Shorts/AV1) →
            //     init-Segment verwerfen (Kopf steckt im Body), fertig.
            // (b) Body = genau die angeforderte Chunk-Länge, aber Status 200
            //     statt 206 (YouTube liefert das bei manchen Chunks) → die
            //     Range wurde korrekt angewendet. Normal weiter wie bei 206.
            const expectedLen = end - start + 1;
            const complete = (knownTotal > 0) && (buf.byteLength === knownTotal);
            const rangeShaped = (buf.byteLength === expectedLen);
            if (complete) {
              console.warn('[xYT] DASH-200: komplette Datei statt Range (start=' + start + ') — init-Segment wird verworfen.');
              initBytes.length = 0;
              chunks.length = 0;
              chunks.push(buf);
              received = buf.byteLength;
              if (onProgress) onProgress(received, knownTotal);
              finishOk();
              return;
            }
            if (!rangeShaped) {
              throw new Error('unvollständiger Chunk: HTTP 200 mit unerwarteter Länge (' + buf.byteLength + ' B statt ' + expectedLen + ' B, knownTotal ' + knownTotal + ')');
            }
            dbg('[xYT] DASH-200: Status 200, aber exakt angeforderte Länge (' + buf.byteLength + ' B) — behandle wie 206.');
          }
          const prev = received;
          chunks.push(buf);
          received += buf.byteLength;
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
          // v1.1.11: Keine zusätzliche `parts`-Kopie des Arrays mehr — die
          // Chunk-Referenzen werden zweimal direkt durchlaufen (Summe, dann
          // Füllen). Das Ziel-Uint8Array bleibt die einzige große Kopie.
          let total = 0;
          for (const c of initBytes) total += c.byteLength;
          for (const c of chunks) total += c.byteLength;
          // v1.1.12: ArrayBuffer-Limit prüfen, bevor allokiert wird.
          if (total > MAX_BUFFER_BYTES) {
            reject(new Error('Datei zu groß für den Browser: ' + fmtGB(total) + ' (Grenze ' + fmtGB(MAX_BUFFER_BYTES) + ') — bitte eine niedrigere Qualität wählen.'));
            return;
          }
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of initBytes) {
            out.set(c instanceof Uint8Array ? c : new Uint8Array(c), off);
            off += c.byteLength;
          }
          for (const c of chunks) {
            out.set(c instanceof Uint8Array ? c : new Uint8Array(c), off);
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

    // Segmente: alles nach moov, sidx raus.
    // v1.1.11: Video-Segmente als subarray-VIEWS statt Kopien (werden nicht
    // mutiert) — spart bei großen Dateien eine vollständige Pufferkopie.
    // Audio-Segmente bleiben Kopien, weil patchTfhdInSegment sie in-place
    // verändert und die Eingabe unangetastet bleiben muss.
    // v1.1.14: `>=` statt `>` — eine Box, die GENAU bei moov.end beginnt, ist
    // bereits ein Medien-Segment (moof). Mit `>` fehlte das erste moof bei
    // Streams OHNE sidx; die Datei begann dann mit einem mdat ohne moof
    // (defekt). Mit sidx fiel es nicht auf, weil das sidx bei moov.end liegt
    // und ohnehin gefiltert wird.
    const vSegs = [], aSegs = [];
    for (const box of vBoxes) if (box.start >= vMoov.end && box.type !== 'sidx') vSegs.push(videoU8.subarray(box.start, box.end));
    for (const box of aBoxes) if (box.start >= aMoov.end && box.type !== 'sidx') aSegs.push(audioU8.slice(box.start, box.end));
    for (const seg of aSegs) patchTfhdInSegment(seg, 2);

    // v1.1.13: Rückgabe als BLOB statt als zusammenhängendes Uint8Array. Die
    // Segmente sind subarray-Views auf die bereits geladenen Streams; ein Blob
    // referenziert sie nur (keine zweite Gesamtkopie). Dadurch ist die
    // Gesamtdatei nicht mehr durch das 2-GB-ArrayBuffer-Limit begrenzt —
    // begrenzt bleibt nur der einzelne Stream (der im Heap liegt).
    return new Blob([videoU8.subarray(vFtyp.start, vFtyp.end), moov, ...vSegs, ...aSegs], { type: 'video/mp4' });
  }

  // ===========================================================================
  // v1.1.14: STREAMING-MERGE über das Origin Private File System (OPFS).
  // Damit werden Video- und Audiostreams CHUNKWEISE geparst und direkt in eine
  // Datei geschrieben — kein vollständiger Stream-ArrayBuffer im RAM. Die
  // fertige Datei wird als File (Blob) an <a download> übergeben; der Browser
  // streamt sie auf die Platte. OPFS ist in Chromium, Firefox (111+) und
  // Safari (15.2+) verfügbar; ohne OPFS bleibt der In-Memory-Pfad.
  // ===========================================================================
  function mergeBoxHelpers() {
    const u32 = (b, o) => ((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0);
    const setU32 = (b, o, val) => { b[o] = (val >>> 24) & 0xFF; b[o + 1] = (val >>> 16) & 0xFF; b[o + 2] = (val >>> 8) & 0xFF; b[o + 3] = val & 0xFF; };
    const typeAt = (b, o) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    function topBoxes(b) {
      const res = []; let off = 0;
      while (off + 8 <= b.length) {
        const size = u32(b, off);
        if (size < 8 || off + size > b.length) break;
        res.push({ type: typeAt(b, off), start: off, size, end: off + size });
        off += size;
      }
      return res;
    }
    function childBoxes(b, box) {
      const res = []; let off = box.start + 8;
      while (off + 8 <= box.end) {
        const size = u32(b, off);
        if (size < 8 || off + size > box.end) break;
        res.push({ type: typeAt(b, off), start: off, size, end: off + size });
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
    function patchTfhdInSegment(seg, newTrackId) {
      if (seg.length < 8 || typeAt(seg, 0) !== 'moof') return false;
      const stack = [{ start: 8, end: seg.length }];
      while (stack.length) {
        const cur = stack.pop();
        let off = cur.start;
        while (off + 8 <= cur.end) {
          const size = u32(seg, off);
          const t = typeAt(seg, off);
          if (size < 8 || off + size > cur.end) break;
          if (t === 'tfhd') { setU32(seg, off + 12, newTrackId); return true; }
          if (t === 'traf' || t === 'moof') stack.push({ start: off + 8, end: off + size });
          off += size;
        }
      }
      return false;
    }
    return { u32, setU32, topBoxes, childBoxes, concat, patchTfhdInSegment };
  }

  // Baut ftyp + moov (beide traks) aus den Init-Segmenten — identische Logik
  // wie in mergeFmp4, nur ohne die Medien-Segmente.
  function buildMergeHeader(videoInit, audioInit) {
    const h = mergeBoxHelpers();
    const vBoxes = h.topBoxes(videoInit);
    const aBoxes = h.topBoxes(audioInit);
    const vFtyp = vBoxes.find(x => x.type === 'ftyp');
    const vMoov = vBoxes.find(x => x.type === 'moov');
    const aMoov = aBoxes.find(x => x.type === 'moov');
    if (!vFtyp || !vMoov || !aMoov) throw new Error('ftyp/moov fehlt im Init-Segment');
    const vKids = h.childBoxes(videoInit, vMoov);
    const aKids = h.childBoxes(audioInit, aMoov);
    const mvhd = vKids.find(x => x.type === 'mvhd');
    const vTrak = vKids.find(x => x.type === 'trak');
    const vMvex = vKids.find(x => x.type === 'mvex');
    const aTrak = aKids.find(x => x.type === 'trak');
    const aMvex = aKids.find(x => x.type === 'mvex');
    if (!mvhd || !vTrak || !vMvex || !aTrak || !aMvex) throw new Error('moov-Bestandteil fehlt');
    const mvhdCopy = videoInit.slice(mvhd.start, mvhd.end);
    h.setU32(mvhdCopy, mvhdCopy.length - 4, 3);
    const vTrakCopy = videoInit.slice(vTrak.start, vTrak.end);
    const aTrakCopy = audioInit.slice(aTrak.start, aTrak.end);
    const aTkhd = h.childBoxes(aTrakCopy, { start: 0, size: aTrakCopy.length, end: aTrakCopy.length }).find(x => x.type === 'tkhd');
    if (!aTkhd) throw new Error('audio-tkhd fehlt');
    const aVer = aTrakCopy[aTkhd.start + 8];
    h.setU32(aTrakCopy, aTkhd.start + 16 + (aVer === 1 ? 12 : 4), 2);
    const vMvexCopy = videoInit.slice(vMvex.start, vMvex.end);
    const aTrex = h.childBoxes(audioInit, aMvex).find(x => x.type === 'trex');
    if (!aTrex) throw new Error('audio-trex fehlt');
    const aTrexCopy = audioInit.slice(aTrex.start, aTrex.end);
    h.setU32(aTrexCopy, 12, 2);
    const mvexContent = h.concat([vMvexCopy.slice(8), aTrexCopy]);
    const mvex = new Uint8Array(8 + mvexContent.length);
    h.setU32(mvex, 0, 8 + mvexContent.length);
    mvex[4] = 109; mvex[5] = 118; mvex[6] = 101; mvex[7] = 120;
    mvex.set(mvexContent, 8);
    const moovContent = h.concat([mvhdCopy, mvex, vTrakCopy, aTrakCopy]);
    const moov = new Uint8Array(8 + moovContent.length);
    h.setU32(moov, 0, 8 + moovContent.length);
    moov[4] = 109; moov[5] = 111; moov[6] = 111; moov[7] = 118;
    moov.set(moovContent, 8);
    const ftyp = videoInit.slice(vFtyp.start, vFtyp.end);
    return { ftyp, moov };
  }

  // Streamender Box-Parser: sammelt VOLLSTÄNDIGE Top-Level-Boxen, auch wenn
  // eine Box über mehrere Netzwerk-Chunks verteilt ist (Carry-Puffer).
  function makeBoxCollector() {
    const boxes = [];
    let carry = new Uint8Array(0);
    return {
      push(chunk) {
        if (!chunk || !chunk.byteLength) return;
        let buf;
        if (carry.byteLength) {
          buf = new Uint8Array(carry.byteLength + chunk.byteLength);
          buf.set(carry, 0);
          buf.set(chunk, carry.byteLength);
        } else {
          buf = chunk;
        }
        let off = 0;
        while (off + 8 <= buf.byteLength) {
          const size = (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;
          if (size < 8) { off = buf.byteLength; break; }
          if (off + size > buf.byteLength) break;
          const type = String.fromCharCode(buf[off + 4], buf[off + 5], buf[off + 6], buf[off + 7]);
          boxes.push({ type, box: buf.subarray(off, off + size) });
          off += size;
        }
        carry = buf.subarray(off);
        if (carry.byteLength > 128 * 1024 * 1024) throw new Error('Box zu groß im Stream (' + carry.byteLength + ' B)');
      },
      take() { const b = boxes.slice(); boxes.length = 0; return b; },
      end() { if (carry.byteLength) throw new Error('unvollständige Box am Stream-Ende (' + carry.byteLength + ' B)'); }
    };
  }

  // Lädt einen Stream chunkweise, parst die Boxen und schreibt sie (ohne sidx,
  // Audio-moof mit gepatchter Track-ID) in den OPFS-Writer.
  async function streamWriteTrack(writer, url, size, startOffset, trackId, signal, onBytes, collector) {
    for (let start = startOffset; start < size; start += CHUNK_SIZE) {
      if (signal && signal.aborted) throw new Error('Abgebrochen');
      const end = Math.min(start + CHUNK_SIZE - 1, size - 1);
      const r = await fetchRangeChunk(url, start, end, signal);
      if (r.aborted) throw new Error('Abgebrochen');
      if (!r.ok || !r.bytes) throw new Error('Chunk ' + start + ' Status ' + r.status);
      collector.push(new Uint8Array(r.bytes));
      const boxes = collector.take();
      for (const b of boxes) {
        if (b.type === 'sidx') continue;
        if (trackId === 2 && b.type === 'moof') mergeBoxHelpers().patchTfhdInSegment(b.box, 2);
        await writer.write(b.box);
        if (onBytes) onBytes(b.box.byteLength);
      }
    }
    collector.end();
  }

  // ===========================================================================
  // v1.1.16: TAB-SICHERE OPFS-DATEIVERWALTUNG.
  // Jede Zwischendatei bekommt eine eindeutige ID und wird während des
  // Schreibens durch ein Web-Lock (navigator.locks) geschützt. Ein Cleanup
  // löscht eine Datei NUR, wenn ihr Lock nachweislich frei ist UND sie alt
  // genug ist (laufende Blob-Downloads brauchen die Datei noch). Ohne Web Lock
  // (ältere Browser) werden fremde Dateien gar nicht angefasst — nur sehr alte
  // Karteileichen (> 6 h).
  // ===========================================================================
  const MERGE_PREFIX = 'xyt-merge-';
  const MERGE_STALE_MS = 30 * 60 * 1000;            // mit Web Locks: Karenz für laufende Downloads
  const MERGE_STALE_NO_LOCKS_MS = 6 * 60 * 60 * 1000; // ohne Web Locks: nur echte Karteileichen
  let activeOpfsName = null;

  function mergeLockName(fileName) { return 'xyt-lock-' + fileName; }
  function webLocksAvailable() {
    try { return !!(navigator.locks && typeof navigator.locks.request === 'function'); } catch (e) { return false; }
  }
  // Führt fn unter exklusivem Lock für diese Datei aus (Fallback: ohne Lock).
  async function withMergeLock(fileName, fn) {
    if (!webLocksAvailable()) return fn();
    return navigator.locks.request(mergeLockName(fileName), { mode: 'exclusive' }, fn);
  }
  // true = Lock gehalten (Datei aktiv), false = frei (verwaist), null = unbekannt.
  async function mergeLockHeld(fileName) {
    if (!webLocksAvailable()) return null;
    let held = false;
    await navigator.locks.request(mergeLockName(fileName), { ifAvailable: true }, async (lock) => { held = !lock; });
    return held;
  }
  function mergeFileTimestamp(n) {
    const m = String(n).match(/xyt-merge-(?:[a-z0-9]+-)?(\d{13})\.mp4$/i);
    return m ? Number(m[1]) : 0;
  }
  // Entfernt ausschließlich verwaiste, ausreichend alte Zwischendateien.
  async function cleanupOpfsMerges(root, ownName) {
    if (typeof root.entries !== 'function') return 0;
    const now = Date.now();
    const hasLocks = webLocksAvailable();
    const names = [];
    for await (const entry of root.entries()) {
      const n = Array.isArray(entry) ? entry[0] : (entry && entry.name);
      if (n && n.indexOf(MERGE_PREFIX) === 0) names.push(n);
    }
    let removed = 0;
    for (const n of names) {
      if (ownName && n === ownName) continue;
      const ts = mergeFileTimestamp(n);
      const age = ts ? (now - ts) : Infinity;
      if (!hasLocks) {
        if (age < MERGE_STALE_NO_LOCKS_MS) continue;
      } else {
        if (age < MERGE_STALE_MS) continue;
        if (await mergeLockHeld(n)) continue;
      }
      try { await root.removeEntry(n); removed++; } catch (e) { /* ignore */ }
    }
    return removed;
  }

  // Beim Verlassen der Seite die eigene Zwischendatei freigeben (best effort —
  // ein laufender Blob-Download endet mit der Seite ohnehin).
  window.addEventListener('pagehide', function () {
    const n = activeOpfsName;
    if (!n) return;
    activeOpfsName = null;
    try {
      navigator.storage.getDirectory().then(function (root) {
        return root.removeEntry(n);
      }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  });

  // Führt beide Streams streamend in eine OPFS-Datei zusammen und liefert File.
  async function streamMergeToOpfs(o) {
    if (!(navigator.storage && navigator.storage.getDirectory) || typeof FileSystemFileHandle === 'undefined' || !FileSystemFileHandle.prototype.createWritable) {
      throw new Error('OPFS-Streaming wird von diesem Browser nicht unterstützt');
    }
    const vInit = await fetchRangeChunk(o.vUrl, 0, o.vInitEnd, o.signal);
    if (vInit.aborted) throw new Error('Abgebrochen');
    if (!vInit.ok || !vInit.bytes) throw new Error('Video-Init fehlgeschlagen (Status ' + vInit.status + ')');
    const aInit = await fetchRangeChunk(o.aUrl, 0, o.aInitEnd, o.signal);
    if (aInit.aborted) throw new Error('Abgebrochen');
    if (!aInit.ok || !aInit.bytes) throw new Error('Audio-Init fehlgeschlagen (Status ' + aInit.status + ')');
    const header = buildMergeHeader(new Uint8Array(vInit.bytes), new Uint8Array(aInit.bytes));
    const root = await navigator.storage.getDirectory();
    // v1.1.16: Nur verwaiste Dateien entfernen (Lock frei + alt genug).
    try {
      const removed = await cleanupOpfsMerges(root, null);
      if (removed) dbg('[xYT] OPFS-CLEANUP: ' + removed + ' verwaiste Zwischendatei(en) entfernt');
    } catch (e) { /* OPFS-Aufräumen ist optional */ }
    const name = MERGE_PREFIX + Math.random().toString(36).slice(2, 8) + '-' + Date.now() + '.mp4';
    activeOpfsName = name;
    const fh = await root.getFileHandle(name, { create: true });
    const writer = await fh.createWritable();
    let received = 0;
    const total = (Number(o.vSize) || 0) + (Number(o.aSize) || 0);
    const tick = (n) => { received += n; if (o.onProgress) o.onProgress(received, total); };
    try {
      // v1.1.16: Schreiben unter exklusivem Web-Lock — andere Tabs sehen die
      // Datei damit als AKTIV und lassen sie unangetastet.
      await withMergeLock(name, async () => {
        await writer.write(header.ftyp); tick(header.ftyp.byteLength);
        await writer.write(header.moov); tick(header.moov.byteLength);
        await streamWriteTrack(writer, o.vUrl, o.vSize, o.vStart, 1, o.signal, tick, makeBoxCollector());
        await streamWriteTrack(writer, o.aUrl, o.aSize, o.aStart, 2, o.signal, tick, makeBoxCollector());
        await writer.close();
      });
      const file = await fh.getFile();
      return { blob: file, opfsName: name, bytes: received };
    } catch (e) {
      try { await writer.abort(); } catch (e2) { /* ignore */ }
      try { await root.removeEntry(name); } catch (e3) { /* ignore */ }
      activeOpfsName = null;
      throw e;
    }
  }

  // v1.1.14: Kann dieser Browser streamend in eine OPFS-Datei schreiben?
  // (Chromium, Firefox 111+, Safari 15.2+; ohne OPFS bleibt der RAM-Pfad.)
  function opfsSupported() {
    try {
      return !!(navigator.storage && navigator.storage.getDirectory
        && typeof FileSystemFileHandle !== 'undefined'
        && FileSystemFileHandle.prototype.createWritable);
    } catch (e) { return false; }
  }

  // Wählt den besten MP4-Audio-Stream für den Merge (itag 140 AAC bevorzugt).
  // Nur MP4-Audio (mp4a/AAC) passt in den MP4-Container — Opus/WEBM nicht.
  function pickMergeAudio(audioOnly) {
    if (!Array.isArray(audioOnly) || audioOnly.length === 0) return null;
    // v1.0.98: NUR MP4-Audio. Vorher fiel die Auswahl auf beliebiges Audio
    // zurück (z. B. WebM/Opus) — mergeFmp4 kann das nicht muxen, der Fehler
    // fiel erst nach dem kompletten Download auf. Jetzt: kein Merge-Angebot,
    // das Panel kennzeichnet die Qualität als „nur Video".
    const mp4 = audioOnly.filter(function (s) { return (s.mime || '').indexOf('audio/mp4') === 0; });
    if (mp4.length === 0) return null;
    // Höchste Bitrate zuerst (extractStreams sortiert schon, hier zusätzlich sichern)
    mp4.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
    return mp4[0] || null;
  }

  // v1.0.98: kompakte Codec-/Container-Labels für die Qualitätsauswahl.
  function shortCodec(codec) {
    const c = String(codec || '').toLowerCase();
    if (c.indexOf('avc1') === 0 || c.indexOf('avc3') === 0) return 'H.264';
    if (c.indexOf('av01') === 0) return 'AV1';
    if (c.indexOf('vp9') === 0 || c.indexOf('vp09') === 0) return 'VP9';
    if (c.indexOf('mp4a') === 0) return 'AAC';
    if (c.indexOf('opus') === 0) return 'Opus';
    return c ? c.split('.')[0].toUpperCase() : '';
  }
  function containerLabel(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.indexOf('video/mp4') === 0 || m.indexOf('audio/mp4') === 0) return 'MP4';
    if (m.indexOf('video/webm') === 0 || m.indexOf('audio/webm') === 0) return 'WebM';
    return '';
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

  function fetchAndroidVrPlayer(videoId, externalSignal) {
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
      // v1.0.94: Zeitlimit + technischer Abbruch. Ohne Limit blieb das Panel bei
      // ausbleibender Antwort dauerhaft auf „Formate werden geladen …". Der
      // AbortController gibt die Verbindung frei; der externe Signalabbruch
      // (Video-Wechsel / neuer Ladevorgang / Panel geschlossen) greift sofort.
      const PLAYER_TIMEOUT_MS = 15000;
      const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      let settled = false;
      let timer = null;
      function finish(fn, val) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(val);
      }
      timer = setTimeout(function () {
        try { if (ctrl) ctrl.abort(); } catch (e) { /* ignore */ }
        finish(reject, new Error('Zeitüberschreitung: YouTube hat innerhalb von ' + (PLAYER_TIMEOUT_MS / 1000) + ' s nicht geantwortet.'));
      }, PLAYER_TIMEOUT_MS);
      if (ctrl && externalSignal && typeof externalSignal.addEventListener === 'function') {
        if (externalSignal.aborted) {
          finish(reject, new Error('Anfrage abgebrochen.'));
        } else {
          externalSignal.addEventListener('abort', function () {
            try { ctrl.abort(); } catch (e) { /* ignore */ }
            finish(reject, new Error('Anfrage abgebrochen.'));
          });
        }
      }
      try {
        // v1.0.80: Player-Request per Seiten-`fetch` statt GM_xmlhttpRequest.
        // GM_xmlhttpRequest läuft im Tampermonkey-Sandbox-Kontext ohne die
        // Browser-Session → YouTube antwortet mit LOGIN_REQUIRED
        // ("Sign in to confirm you're not a bot"). fetch läuft im Seiten-Kontext
        // mit der echten YouTube-Session und umgeht die Bot-Prüfung (verifiziert
        // 2026-08-28 im Playwright: Seiten-fetch liefert status OK, 25+ Formate).
        fetch(YT_PLAYER_ENDPOINT, {
          method: 'POST',
          headers: headers,
          body: body,
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (res) {
          return res.json();
        }).then(function (j) {
          const status = j && j.playabilityStatus && j.playabilityStatus.status;
          // v1.0.70: Livestream-Statuswerte mit verständlicher Meldung abfangen.
          if (status === 'LIVE_STREAM_OFFLINE' || status === 'LIVE_STREAM_ENDED') {
            finish(reject, new Error('Dieser Livestream ist nicht verfügbar (offline/beendet). Live-Übertragungen können nicht heruntergeladen werden.'));
            return;
          }
          if (status && status !== 'OK') {
            finish(reject, new Error('YouTube-Status: ' + status + (j.playabilityStatus && j.playabilityStatus.reason ? ' — ' + j.playabilityStatus.reason : '')));
            return;
          }
          if (isLivePlayerResponse(j)) {
            finish(reject, new Error('Dieses Video ist ein Livestream und kann nicht heruntergeladen werden.'));
            return;
          }
          if (!j || !j.streamingData) {
            finish(reject, new Error('Keine streamingData in der Player-Antwort'));
            return;
          }
          finish(resolve, j);
        }).catch(function (e) {
          if (e && e.name === 'AbortError') {
            finish(reject, new Error('Anfrage abgebrochen.'));
            return;
          }
          finish(reject, new Error('Player-Netzwerk-/Parsefehler: ' + (e && e.message ? e.message : String(e))));
        });
      } catch (e) {
        finish(reject, e);
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
  // POSITIONSFIX (2026-10-17): Die Wartezeit gilt JE VIDEO-NAVIGATION, nicht einmal
  // pro Seiten-Load. Vorher lief sie ab PAGE_START (Skriptstart) und war nach dem
  // ersten Video dauerhaft abgelaufen — bei jedem SPA-Wechsel fiel der Button
  // deshalb sofort in den Player, sobald die Leiste kurz (nach-)gerendert wurde.
  let barWaitStart = PAGE_START;
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

  // Die Action-Leiste (Like/Teilen/Speichern) — zentrale Auswahl, damit findAnchor()
  // und der Positions-Update in attachButton() dieselbe Leiste meinen.
  // POSITIONSFIX (2026-10-17): YouTube hat MEHRERE Elemente mit der ID
  // #top-level-buttons-computed (u. a. im Engagement-Panel und in #info-contents).
  // Diese Duplikate sind leer und 0×0; querySelector() nimmt aber immer das ERSTE
  // im DOM — je nach Render-Reihenfolge war das die versteckte Leiste, isElementVisible
  // schlug fehl und der Button landete im Player. Deshalb: nur eine GEFÜLLTE und
  // SICHTBARE Leiste gilt als Anker.
  function getBar() {
    const all = Array.from(document.querySelectorAll('#top-level-buttons-computed'));
    // v1.0.95: Bevorzugt die Leiste in der SICHTBAREN ytd-watch-metadata. Beim
    // SPA-Wechsel bleiben alte Watch-Container (samt eigener Leiste) im DOM;
    // deren Leiste kann Größe > 0 haben und war damit ein „gültiger" Anker —
    // der Button blieb dort hängen und wurde unsichtbar/unbedienbar.
    for (const b of all) {
      const meta = b.closest ? b.closest('ytd-watch-metadata') : null;
      if (!meta || !isElementVisible(meta)) continue;
      if (!b.children || b.children.length === 0) continue;
      if (!isElementVisible(b)) continue;
      return b;
    }
    // Fallback (Shorts /live / ältere Layouts): erste gefüllte, sichtbare Leiste.
    // Eine Leiste, die NUR unseren Button enthält, zählt nicht als Anker —
    // sonst bestätigt sich eine veraltete Platzierung selbst.
    for (const b of all) {
      if (!b.children || b.children.length === 0) continue;
      if (b.children.length === 1 && b.children[0] === btn) continue;
      if (isElementVisible(b)) return b;
    }
    return null;
  }

  function findAnchor() {
    // Bevorzugt: Action-Leiste unter dem Video (Like/Teilen/...)
    const bar = getBar();
    if (bar) return { el: bar, mode: 'bar' };
    // Erst nach der Wartezeit auf den Player-Fallback zurückfallen — so erscheint
    // der Button beim Reload direkt in der Leiste statt erst oben rechts im Video.
    // Auf /shorts gibt es keine Action-Leiste → sofort Player-Overlay statt 4 s warten.
    const shortsPath = /^\/shorts\//.test(window.location.pathname);
    if (!shortsPath && Date.now() - barWaitStart < BAR_WAIT_MS) return null;
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

  // POSITIONSFIX (2026-10-17): Der Button gehörte bisher per appendChild immer ans
  // ENDE der Leiste (rechts neben „Speichern"). Jetzt wird er VOR „Speichern" (DE)
  // bzw. „Save"/„Save to …" (EN) eingefügt; wenn kein solcher Button gefunden wird,
  // bleibt der bisherige Weg (ans Ende) als Fallback.
  function insertIntoBar(bar) {
    try {
      const kids = bar.querySelectorAll('ytd-button-renderer, yt-button-view-model, button, a[role="button"]');
      for (const c of kids) {
        if (c === btn || c.contains(btn)) continue;
        const raw = (c.getAttribute && (c.getAttribute('aria-label') || c.getAttribute('title'))) || '';
        const label = String(raw).trim().toLowerCase();
        if (!label) continue;
        if (label.indexOf('speichern') >= 0 || label === 'save' || label.indexOf('save to') === 0) {
          c.insertAdjacentElement('beforebegin', btn);
          return true;
        }
      }
    } catch (e) { /* ignore */ }
    bar.appendChild(btn);
    return true;
  }

  function attachButton() {
    ensureUi();
    // Ziel = Action-Leiste, sobald sie sichtbar ist; Player-Overlay nur als
    // Fallback (Shorts, langsamer Aufbau). Geprüft wird bei jedem Aufruf der
    // Ist-Zustand (Container + Video-ID + Modus), kein einmal gesetztes Flag —
    // so wandert der Button aus dem Player zurück in die Leiste, sobald sie da ist.
    const videoId = getVideoId();
    const anchor = findAnchor();
    if (!anchor) {
      // Diagnose (Anforderung: Zustand in Konsole prüfbar) — aber GEDROSSELT:
      // Der MutationObserver feuert bei jeder YouTube-DOM-Mutation hunderte Male
      // pro Sekunde; ohne Drossel überfluten identische Meldungen die Konsole
      // (Ede: ~1000 Zeilen „kein Anker" in <300 ms). Max. 1 Log pro Sekunde.
      const waited = Date.now() - barWaitStart;
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
    const wantOverlay = anchor.mode !== 'bar';

    // Ziel bereits erreicht? Gleicher Container, gleiche Video-ID, gleicher Modus
    // → nichts tun (kein Flackern, kein unnötiges Reflow).
    // Die frühere Pauschal-Sperre (anchorLocked) ist bewusst entfernt: Sie ließ
    // einen einmal im Player platzierten Button dauerhaft dort, auch wenn die
    // Action-Leiste Sekundenbruchteile später sichtbar wurde.
    if (btn.parentElement === el && btnVideoId === videoId
        && btn.classList.contains('xyt-dl-overlay') === wantOverlay) {
      return true;
    }

    // Doppelte Buttons entfernen (z. B. aus einer parallel laufenden alten Instanz).
    try {
      const all = document.querySelectorAll('#xyt-dl-btn');
      for (const x of all) { if (x !== btn) x.remove(); }
    } catch (e) { /* ignore */ }

    if (!wantOverlay) {
      if (btn.parentElement) btn.remove();
      // Inline-Position zurücksetzen (falls zuvor als Overlay position:absolute
      // gesetzt wurde), damit die Leisten-Darstellung (position:relative aus CSS)
      // greift — sonst bliebe der Button absolut positioniert und unsichtbar.
      btn.style.position = '';
      btn.style.bottom = '';
      btn.style.right = '';
      btn.style.zIndex = '';
      btn.classList.remove('xyt-dl-overlay');
      insertIntoBar(el);
      dbg('[xYT] Button in Action-Leiste injiziert (vor „Speichern", sonst ans Ende)');
    } else {
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
    btnVideoId = videoId;
    return true;
  }

  function onBtnClick(e) {
    try {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      // v1.0.95: Nur schließen, wenn das Panel wirklich sichtbar ist. Vorher
      // schluckte ein Klick auf den Button ein off-screen/verdecktes Panel —
      // der Nutzer erlebte „Button reagiert nicht".
      if (panel.style.display === 'block' && isElementVisible(panel)) { hidePanel(); return; }

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
      // v1.1.03: Panel wird (wieder) geöffnet — laufende Schließ-Timer aus einem
      // früheren Lauf werden ungültig, damit sie das neue Panel nicht schließen.
      invalidatePanelClose();
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
  // v1.0.94: Sequenznummer + Abort — Antworten alter Anfragen dürfen ein neueres
  // Video oder einen erneuten Versuch nicht mehr überschreiben.
  async function loadStreamsIntoPanel(videoId, title) {
    const mySeq = ++loadSeq;
    if (playerAbort) { try { playerAbort.abort(); } catch (e) { /* ignore */ } }
    playerAbort = (typeof AbortController === 'function') ? new AbortController() : null;
    const signal = playerAbort ? playerAbort.signal : null;
    try {
      if (!videoId) {
        if (mySeq === loadSeq) renderPanelMessage('Keine gültige Videoseite erkannt (kein ?v= Parameter).', true, retryFromPanel);
        return;
      }
      const pr = await fetchAndroidVrPlayer(videoId, signal);
      if (mySeq !== loadSeq) {
        dbg('[xYT] Veraltete Formatanfrage verworfen (seq ' + mySeq + ' ≠ ' + loadSeq + ')');
        return;
      }
      if (videoId !== getVideoId()) {
        dbg('[xYT] Formatanfrage gehört zu anderem Video (' + videoId + ') — verworfen.');
        return;
      }
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
      if (mySeq !== loadSeq) return; // veraltete Anfrage: Panel nicht mehr anfassen
      renderPanelMessage('Formate konnten nicht geladen werden: ' + (err && err.message ? err.message : String(err)), true, retryFromPanel);
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

  // v1.0.94: „Erneut versuchen" — lädt die Formate für die AKTUELLE Video-ID neu.
  function retryFromPanel() {
    const id = getVideoId();
    const t = getVideoTitle();
    if (!id) { renderPanelMessage('Keine gültige Videoseite erkannt (kein ?v= Parameter).', true); return; }
    dbg('[xYT] Retry: Formate erneut laden für ' + id);
    renderPanelLoading(id, t);
    positionPanel();
    loadStreamsIntoPanel(id, t);
  }

  function renderPanelMessage(msg, isError, retryFn) {
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
    // v1.0.94: optionaler Retry-Knopf (nur bei wiederholbaren Ladefehlern).
    if (typeof retryFn === 'function') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'xyt-dl-opt';
      retry.style.marginTop = '10px';
      retry.textContent = '↻ Erneut versuchen';
      retry.addEventListener('click', retryFn);
      panel.appendChild(retry);
    }
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
        // v1.0.98: kompakte Technik-Zeile — Auflösung · Container/Codec · Größe
        // und ein knapper Ton-Status. Details stehen im Tooltip (b.title).
        const label = s.label + (s.fps >= 60 ? ' ' + s.fps + 'fps' : '');
        const sizeTxt = s.size ? ' · ' + formatBytes(s.size) : '';
        const autoMerge = s.hasAudio ? null : mergeAudio;
        const tech = (containerLabel(s.mime) || '?') + (shortCodec(s.codec) ? '/' + shortCodec(s.codec) : '');
        let tonTxt = '';
        if (s.hasAudio) tonTxt = ' · mit Ton';
        else if (autoMerge) tonTxt = ' · + Ton';
        else tonTxt = ' · nur Video';
        b.textContent = label + ' · ' + tech + sizeTxt + tonTxt;
        b.title = s.hasAudio
          ? (s.mime + ' (Codec ' + (s.codec || '?') + ') · enthält bereits Ton')
          : (autoMerge
            ? (s.mime + ' (Codec ' + (s.codec || '?') + ') + Audio ' + autoMerge.mime + ' → wird zu EINER MP4 mit Ton zusammengeführt')
            : (s.mime + ' (Codec ' + (s.codec || '?') + ') · KEIN MP4-Audio verfügbar — wird als reine Videodatei gespeichert'));
        // Diagnose: Kennzeichnung + Merge-Entscheidung in der Konsole
        dbg('[xYT] DIAGNOSE-PANEL: itag=' + s.itag
          + ' | Text="' + b.textContent + '"'
          + ' | autoMerge=' + (autoMerge ? 'ja (Audio itag ' + autoMerge.itag + ')' : 'nein'));
        b.dataset.itag = String(s.itag || '');
        b.dataset.url = s.url || '';
        b.addEventListener('click', function () {
          // v1.1.05: KEINE URL-Fragmente mehr loggen — signierte googlevideo-URLs
          // enthalten Tokens (`sig`, `lsig`, `pot`, `ei` …). Nur Host/Pfad-Kopf.
          let host = '?';
          try { host = new URL(this.dataset.url).host; } catch (e) { /* ignore */ }
          dbg('[xYT] Klick: itag=' + this.dataset.itag + ' | host=' + host
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
    // v1.0.98: eigener Abbruchkanal je Download — getrennt vom Formatanfrage-
    // Abort (playerAbort), damit ein SPA-Wechsel den Download nicht killt und
    // ein Download-Abbruch keine Panel-Anfrage trifft.
    dlCancelled = false;
    dlAbort = (typeof AbortController === 'function') ? new AbortController() : null;
    const signal = dlAbort ? dlAbort.signal : null;
    resetProgress('Video');
    // v1.1.03: Ein neuer Download macht Schließ-Timer eines vorigen Laufs
    // ungültig — sonst könnte ein alter Timer den neuen Status ausblenden.
    invalidatePanelClose();
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
      // v1.0.98: sichtbarer Abbrechen-Knopf. Bricht die laufenden Requests
      // technisch ab; es wird keine Datei gespeichert.
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'xyt-dl-opt';
      cancelBtn.style.marginTop = '8px';
      cancelBtn.textContent = '■ Abbrechen';
      cancelBtn.addEventListener('click', function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        cancelDownload();
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Abbrechen …';
      });
      panel.appendChild(cancelBtn);
      const hint = document.createElement('div');
      hint.style.cssText = 'color:#aaa;font-size:11px;margin-top:8px;';
      hint.textContent = stream && stream.size ? ('Dateigröße: ' + formatBytes(stream.size) + ' — wird direkt von YouTube geladen.') : 'Download läuft direkt von YouTube.';
      panel.appendChild(hint);

      const ext = (kind === 'video' ? '.mp4' : '.m4a');
      const filename = sanitizeFilename(title) + ' [' + label + ']' + ext;

      // v1.1.13: Größen-Guard für BEIDE Pfade (progressiv und Merge), also VOR
      // dem ersten Request. Sonst würde ein zu großer Stream erst nach GB
      // scheitern (ArrayBuffer-Limit) oder in den Browser-Fallback laufen.
      const guardMax = Math.max(Number(stream && stream.size) || 0, Number(mergeAudio && mergeAudio.size) || 0);
      // v1.1.14: Mit OPFS-Streaming gibt es keine 2-GB-Sperre mehr — der Guard
      // greift nur, wenn der Browser kein OPFS kann ODER der Stream nicht
      // segmentiert ist (dann fehlt das Init-Segment für den moov-Neubau).
      const canStream = opfsSupported()
        && stream && Number(stream.initEnd) >= 0
        && mergeAudio && Number(mergeAudio.initEnd) >= 0;
      if (guardMax > MAX_BUFFER_BYTES && !canStream) {
        setStatusText('Einzelstream zu groß für den Browser: ' + fmtGB(guardMax) + ' (Grenze ' + fmtGB(MAX_BUFFER_BYTES) + '). Bitte eine niedrigere Qualität wählen.');
        hint.textContent = 'Dieser Browser kann keine Streams über ~2 GB verarbeiten (kein OPFS). 1080p/1440p funktionieren; 2160p nur bei kürzeren Videos.';
        dbg('[xYT] GRÖSSEN-GUARD: ' + guardMax + ' B über Limit ' + MAX_BUFFER_BYTES + ' B — kein Download gestartet');
        return;
      }

      // DIAGNOSE (Download-Pfad): Quelle und Format-Kennwerte — v1.1.08 ohne
      // URL-Fragmente, weil signierte googlevideo-URLs Zugriffswerte enthalten.
      dbg('[xYT] DL-START: kind=' + kind + ' | itag=' + (stream && stream.itag) + ' | label=' + label
        + ' | hasAudio=' + (stream && stream.hasAudio) + ' | Quelle=(' + (stream && stream.srcArray) + ')'
        + ' | host=' + (function () { try { return new URL(String(stream && stream.url)).host; } catch (e) { return 'FEHLT'; } })());
      if (stream && stream.url) {
        const u = String(stream.url);
        dbg('[xYT] DL-URL-PARAMS: range=' + (/range=\d+\/\d+/i.test(u)) + ' | ratebypass=' + (/ratebypass=/i.test(u))
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
        // v1.1.14: STREAMING-PFAD für große Dateien. Ab hier wird nichts mehr
        // als Ganzes in den RAM geladen: Init-Segmente klein, moov neu gebaut,
        // dann chunkweise geparst und direkt in eine OPFS-Datei geschrieben.
        if (canStream && (guardMax > MAX_BUFFER_BYTES || total > MAX_BUFFER_BYTES)) {
          dbg('[xYT] MERGE-STREAMING: Video ' + stream.size + ' B + Audio ' + mergeAudio.size + ' B über OPFS');
          hint.textContent = 'Große Datei: wird schrittweise geschrieben (kein Speicher-Puffer) …';
          const vInitEnd = (Number(stream.indexEnd) >= 0) ? Number(stream.indexEnd) : Number(stream.initEnd);
          const aInitEnd = (Number(mergeAudio.indexEnd) >= 0) ? Number(mergeAudio.indexEnd) : Number(mergeAudio.initEnd);
          const res = await streamMergeToOpfs({
            vUrl: stream.url, aUrl: mergeAudio.url,
            vSize: Number(stream.size) || 0, aSize: Number(mergeAudio.size) || 0,
            vInitEnd: vInitEnd, aInitEnd: aInitEnd,
            vStart: vInitEnd + 1, aStart: aInitEnd + 1,
            signal: signal,
            onProgress: function (rec, tot) { updateProgress('Video+Audio', rec, tot); }
          });
          setBarProgress(100);
          setStatusText('Daten vollständig geladen (' + formatBytes(res.blob.size) + ') — Speichern angestoßen: ' + filename);
          saveBlob(res.blob, filename);
          autoClosePanelAfter();
          hint.textContent = 'Datei (Video + Audio, mit Ton) wird im Browser-Download-Ordner gespeichert.';
          dbg('[xYT] MERGE-STREAMING-FERTIG: ' + res.blob.size + ' B');
          return;
        }
        let vRecv = 0, aRecv = 0;
        // v1.0.98: gemeinsame Fortschrittsanzeige. Bei parallelen Transfers ist
        // die Phase ehrlich „Video+Audio" (keine erfundene Einzelphase).
        function reportMerge() {
          updateProgress('Video+Audio', vRecv + aRecv, total);
        }
        // Beide Streams PARALLEL laden (jeder mit eigener Chunk-Kette)
        const vPromise = downloadStreamBytes(stream.url, stream.size, function (received) { vRecv = received; reportMerge(); }, { itag: stream.itag, videoId: videoId, kind: 'video' }, stream, signal);
        // Verhindert eine unhandled rejection, wenn das Video zuerst aufgibt.
        const aPromise = downloadStreamBytes(mergeAudio.url, mergeAudio.size, function (received) { aRecv = received; reportMerge(); }, { itag: mergeAudio.itag, videoId: videoId, kind: 'audio' }, mergeAudio, signal);
        aPromise.catch(function () { /* wird unten ausgewertet */ });
        let vBytes;
        try {
          vBytes = await vPromise;
        } catch (vErr) {
          // v1.1.08: Endgültiger Video-Fehler → den zugehörigen Audio-Transfer
          // stoppen, statt ihn weiterlaufen zu lassen (keine halben Downloads).
          try { if (dlAbort) dlAbort.abort(); } catch (e) { /* ignore */ }
          dbg('[xYT] MERGE-ABBRUCH: Video fehlgeschlagen — Audio-Transfer beendet.');
          throw vErr;
        }
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
          autoClosePanelAfter();
          hint.textContent = 'Video gespeichert (ohne Ton — Audiostream war nicht verfügbar).';
          return;
        }
        setStatusText('Merge: Video + Audio werden zusammengeführt …');
        dbg('[xYT] MERGE-LADEN-FERTIG: Video=' + vBytes.length + ' B, Audio=' + aBytes.length + ' B');
        // v1.0.98: Größencheck vor dem Muxen — verhindert, dass eine unvollständig
        // geladene Spur unbemerkt in die Ausgabedatei wandert.
        if (Number(stream.size) > 0 && Math.abs(vBytes.length - stream.size) / stream.size > 0.01) {
          const dev = (Math.abs(vBytes.length - stream.size) / stream.size * 100).toFixed(1);
          console.warn('[xYT] GRÖSSENCHECK Video: erwartet ' + stream.size + ' B, erhalten ' + vBytes.length + ' B (' + dev + ' % Abweichung)');
          hint.textContent = 'Warnung: Videospur weicht um ' + dev + ' % von der angekündigten Größe ab.';
        }
        if (Number(mergeAudio.size) > 0 && Math.abs(aBytes.length - mergeAudio.size) / mergeAudio.size > 0.01) {
          const dev = (Math.abs(aBytes.length - mergeAudio.size) / mergeAudio.size * 100).toFixed(1);
          console.warn('[xYT] GRÖSSENCHECK Audio: erwartet ' + mergeAudio.size + ' B, erhalten ' + aBytes.length + ' B (' + dev + ' % Abweichung)');
        }
        let merged;
        try {
          merged = mergeFmp4(vBytes, aBytes);
        } catch (mergeErr) {
          // B1-Fix (2026-10-17): Bisher wurde beim Merge-Fehler NUR die Video-Datei
          // gespeichert — die bereits vollständig geladene Audiospur ging still
          // verloren, obwohl die Meldung „getrennt speichern" behauptete. Jetzt
          // werden BEIDE Dateien geschrieben (Video .mp4 + Audio .m4a/.webm je nach
          // Container); der zweite Download wird leicht verzögert, damit der Browser
          // beide annimmt.
          const mErr = (mergeErr && mergeErr.message ? mergeErr.message : String(mergeErr));
          console.warn('[xYT] Merge fehlgeschlagen (' + mErr + ') — speichere Video UND Audio getrennt.');
          const baseName = filename.replace(/\.mp4$/i, '');
          const audioMp4 = String(mergeAudio.mime || '').toLowerCase().indexOf('audio/mp4') === 0;
          const audioName = baseName + ' (Audio).' + (audioMp4 ? 'm4a' : 'webm');
          const audioMime = audioMp4 ? 'audio/mp4' : 'audio/webm';
          setBarProgress(100);
          setStatusText('Merge nicht möglich — speichere Video und Audio getrennt (2 Dateien) …');
          saveBlob(new Blob([vBytes], { type: 'video/mp4' }), filename);
          dbg('[xYT] MERGE-ERSATZ: Video ' + vBytes.length + ' B → ' + filename + ' | Audio ' + aBytes.length + ' B → ' + audioName + ' (' + audioMime + ')');
          setTimeout(function () {
            try {
              saveBlob(new Blob([aBytes], { type: audioMime }), audioName);
              setStatusText('Merge nicht möglich — Video und Audio getrennt gespeichert (2 Dateien).');
              hint.textContent = 'Zwei Dateien: ' + filename + ' (Video) und ' + audioName + ' (Audio) — Zusammenfügen z. B. mit ffmpeg nötig.';
            } catch (e5) {
              console.warn('[xYT] Audio-Speichern fehlgeschlagen: ' + (e5 && e5.message ? e5.message : String(e5)));
              setStatusText('Merge nicht möglich — NUR Video gespeichert (Audio-Speichern fehlgeschlagen).');
            }
            // v1.1.03: Auto-Schließen beginnt erst NACH dem letzten tatsächlich
            // ausgelösten Speichervorgang (Audio, 900 ms nach dem Video).
            autoClosePanelAfter();
          }, 900);
          return;
        }
        dbg('[xYT] MERGE-OK: gemergt=' + merged.size + ' B (Video ' + vBytes.length + ' + Audio ' + aBytes.length + ')');
        setBarProgress(100);
        setStatusText('Download abgeschlossen: ' + filename);
        // v1.1.13: merged ist bereits ein Blob (keine zweite Gesamtkopie im Heap).
        saveBlob(merged, filename);
        autoClosePanelAfter();
        hint.textContent = 'Datei (Video + Audio, mit Ton) wird im Browser-Download-Ordner gespeichert.';
        return;
      }

      st.textContent = 'Download gestartet: ' + filename;
      st.className = 'xyt-dl-status';
      hint.textContent = 'Datei wird im Browser-Download-Ordner gespeichert.';
      // v1.1.05: Den ECHTEN Abschluss abwarten. Vorher war `running` schon frei,
      // während der Transfer noch lief → ein zweiter Download oder ein Abbruch
      // konnte parallel laufen.
      const res = await downloadUrl(stream.url, filename, stream.size, signal);
      if (res && res.aborted) {
        // Status hat downloadUrl bereits gesetzt; hier nichts überschreiben.
        if (lastJob) lastJob = lastJob; // Retry bleibt verfügbar
      } else if (res && res.ok) {
        setStatusText('Download abgeschlossen: ' + filename + (res.confirmed === false ? ' (Speichern angestoßen)' : ''));
      } else if (res && res.unconfirmed) {
        setStatusText('Browser-Download angestoßen (unbestätigt) — Datei im Download-Ordner prüfen.');
      } else if (res && res.error) {
        throw new Error(res.error);
      }
    } catch (err) {
      // v1.0.98: Abbruch ist kein Fehler — eigener Text, kein Fehler-Overlay.
      const aborted = dlCancelled || (err && err.aborted) || /Abgebrochen/.test(String((err && err.message) || err));
      const st = document.createElement('div');
      st.className = 'xyt-dl-status' + (aborted ? '' : ' err');
      st.textContent = aborted
        ? 'Abgebrochen — keine Datei gespeichert.'
        : ('Fehler: ' + (err && err.message ? err.message : String(err)));
      panel.appendChild(st);
      if (aborted) setBarProgress(0);
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
      dlAbort = null;
    }
  }

  function hidePanel() {
    if (panel) panel.style.display = 'none';
    // v1.1.03: Beim manuellen Schließen laufende Auto-Schließ-Timer entwerten.
    invalidatePanelClose();
    // v1.0.94: laufende Formatanfrage verwerfen und technisch abbrechen, damit
    // eine späte Antwort nicht ein neues Video oder einen Retry überschreibt.
    loadSeq++;
    if (playerAbort) { try { playerAbort.abort(); } catch (e) { /* ignore */ } playerAbort = null; }
  }

  // -------------------------------------------------------------------------
  // SPA-Navigation beobachten (Videowechsel ohne Reload)
  // -------------------------------------------------------------------------
  function scheduleRefresh() {
    setTimeout(() => {
      const id = getVideoId();
      if (id !== boundVideoId) {
        boundVideoId = id;
        barWaitStart = Date.now(); // Wartezeit für DIESES Video neu starten
        // v1.0.95: Button aus der alten Leiste lösen — sonst hängt er an einem
        // veralteten/unsichtbaren Container und ist nicht mehr bedienbar.
        if (btn && btn.parentElement) { try { btn.remove(); } catch (e) { /* ignore */ } }
        btnVideoId = null;
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
        barWaitStart = Date.now(); // Wartezeit für DIESES Video neu starten
        // v1.0.95: Button aus der alten Leiste lösen — sonst hängt er an einem
        // veralteten/unsichtbaren Container und ist nicht mehr bedienbar.
        if (btn && btn.parentElement) { try { btn.remove(); } catch (e) { /* ignore */ } }
        btnVideoId = null;
        hidePanel();
        refresh();
      }
      if (btn && (!btn.isConnected || !isElementVisible(btn))) {
        attachButton();
      } else if (btn && btn.classList.contains('xyt-dl-overlay')) {
        // Button hängt (noch) im Player, obwohl die Leiste inzwischen da ist →
        // in die Action-Leiste hochziehen (Kern des Positionsfixes).
        const b = getBar();
        if (b && isElementVisible(b)) attachButton();
      }
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
        } else if (btn.classList.contains('xyt-dl-overlay')) {
          // Sobald die Action-Leiste sichtbar wird, den Button aus dem Player holen.
          const b = getBar();
          if (b && isElementVisible(b)) attachButton();
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
  // Doppel-Injektion ist ausgeschlossen: attachButton() prüft Container,
  // Video-ID und Modus und hängt nur bei Abweichung um.
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
