# xYTDownloader — Vollständige Entwicklungsdokumentation (Stand 2026-08-05)

> Zweck: Ist-Zustand-Dokumentation des Projekts (v1.0.50). Synchronisiert mit BERICHT.md (§1–§25) und den Builds in `Ausgabe\`.
> Erstellt von: Reasonix-Agent (Arbeitsprojekt des Nutzers Ede).

---

## 1. Projektstruktur (vollständig)

**Arbeitsverzeichnis:** `F:\001_Coding_Projekte\xYTDownloader` (Git-Repository — siehe Abschnitt 8)

```
F:\001_Coding_Projekte\xYTDownloader\
├── xyt-downloader.user.js                  ← ARBEITSVERSION (v1.0.50, 1930 Zeilen, ~88,6 KB) — projekteigener Code
├── BERICHT.md                              ← Abschlussbericht/Projektdoku (v1.0.0–v1.0.50, §1–§25)
├── AGENTS.md                               ← Projekt-Anweisungen für Agenten (Build-Regeln, Architektur, Tests)
├── DOKUMENTATION_ENTWICKLUNGSSTAND.md      ← diese Datei (Ist-Zustand v1.0.50)
├── README.md                               ← Repo-README (dreisprachig EN/DE/RU, im GitHub-Repo)
├── ANALYSE_JD2_YOUTUBE.md                  ← historische Analyse: JD2-Protokoll vs. Userscript (Basis v1.0.18)
├── ANALYSE_DISKREPANZ_PLAYWRIGHT_VS_YANDEX.md ← historische Analyse: Playwright-vs-Yandex-Diskrepanz (Basis v1.0.25)
├── Ausgabe\                                ← Build-Ordner (versionierte Builds v1.0.0 … v1.0.50, alte bleiben erhalten)
│   ├── xyt-downloader-v1.0.0.user.js       (erster Build, veraltet)
│   ├── …                                   (v1.0.1 … v1.0.37; v1.0.15 wurde nie gebaut)
│   ├── xyt-downloader-v1.0.38.user.js
│   ├── xyt-downloader-v1.0.39.user.js
│   ├── xyt-downloader-v1.0.40.user.js
│   ├── xyt-downloader-v1.0.41.user.js
│   ├── xyt-downloader-v1.0.42.user.js
│   ├── xyt-downloader-v1.0.43.user.js
│   ├── xyt-downloader-v1.0.44.user.js
│   ├── xyt-downloader-v1.0.45.user.js
│   ├── xyt-downloader-v1.0.46.user.js
│   ├── xyt-downloader-v1.0.47.user.js
│   ├── xyt-downloader-v1.0.48.user.js
│   ├── xyt-downloader-v1.0.49.user.js
│   └── xyt-downloader-v1.0.50.user.js      ← AKTUELLER BUILD (identisch mit Arbeitsversion, cmp-verifiziert,
│                                             MD5 96854c59c67a3bb5d6abbc6a581f3a40, API-Key = Platzhalter)
├── Youtube Tools All in one local download mp3 mp4 HIGT QUALITY return dislikes and more-2.5.txt
│                                           ← FREMDES Referenz-Script (GreasyFork „Youtube Tools All in one" v2.5, MIT, 267 KB)
│                                             Nur historische Quelle für die savenow/dubs.io-API-Parameter
│                                             (deaktivierter Fallback-Pfad, siehe Abschnitt 3.1). KEIN eigener Code.
├── .playwright-mcp\                        ← AUTOMATISCH generiert (Playwright-Test-Artefakte: Snapshots, Console-Logs, heruntergeladene Testdateien)
└── .reasonix\                              ← AUTOMATISCH generiert (Reasonix-Metadaten, nicht projektrelevant)
```

**Abhängigkeiten:** Keine (kein package.json, keine requirements.txt). Das Script ist **reines Browser-JavaScript ohne Framework/Bibliotheken**; einzige Laufzeit-Abhängigkeiten sind die Tampermonkey-GM-APIs und YouTube (Innertube-Player-Endpoint).

---

## 2. Zusammenfassung: Sprache / Framework / Architektur

| Aspekt | Wert |
|---|---|
| Sprache | JavaScript (ES6+), Vanilla, kein Build-System, keine Transpilation |
| Plattform | Tampermonkey-Userscript (Browser-Erweiterung), getestet in Yandex (Chromium) + Playwright-Chromium |
| Zielseiten | `youtube.com/watch*` **und** `youtube.com/shorts/*` (inkl. `www.`/Subdomains, exkl. `music.youtube.com`) |
| Laufzeit-APIs | `GM_xmlhttpRequest`, `GM_download`, `GM_addStyle` |
| Externe Dienste | **Kein Drittanbieter** — direkter ANDROID_VR-Innertube-Client an `youtube.com/youtubei/v1/player` (Methode von JDownloader2) |
| UI | DOM-Manipulation (kein Framework); Button unten rechts im Player (Overlay) bzw. in der Action-Leiste + eigenes Overlay-Panel |
| Kein lokales Projekt-Setup | kein npm, kein Python, kein Build-Schritt nötig |
| Veröffentlichung | Greasy Fork (Name „xYTDownloader", Skript-ID 589972) + Reddit r/userscripts |

**Architektur-Ablauf (hoch):**
`Button-Klick → videoId ermitteln (?v= oder /shorts/<id>) → ANDROID_VR-Player-Request (POST youtubei/v1/player) → Streams extrahieren (progressive/DASH-videoOnly/audioOnly, flache Liste ≥360p) → Klick auf Auflösung → progressiv: direkter Chunk-Download; DASH-videoOnly: paralleles Laden Video+Audio → clientseitiges fMP4-Merging → Blob speichern (<a download>) → Panel auto-close`.

---

## 3. Technischer Ansatz im Detail

### 3.1 Wie der YouTube-Download realisiert wird
**Direkt über den ANDROID_VR-Innertube-Client** (seit v1.0.19, primärer Pfad — Methode von JDownloader2, siehe `ANALYSE_JD2_YOUTUBE.md`):
- `POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false` mit Client-Config `ANDROID_VR` (Name 28, Version 1.65.10, Oculus Quest 3, Android 12L).
- Die Antwort enthält **direkte, signierte googlevideo-Stream-URLs mit exakter `contentLength`** — ohne POT-Token, ohne 403 (im Gegensatz zum WEB-Client, der nur noch ABR/protobuf mit POT liefert).
- Erforderliche Header (v1.0.21-Fix gegen LOGIN_REQUIRED): `X-Goog-Visitor-Id` (aus `ytcfg`), `Origin`, `Referer`, `Accept-Language`, `Cache-Control`, `contentPlaybackContext` mit `signatureTimestamp`.

**Veraltet/deaktiviert (bleibt als Fallback-Code erhalten):** savenow.to / dubs.io-Extern-API (`DEAKTIVIERTER FALLBACK-PFAD`). Wird seit v1.0.19 nicht mehr aufgerufen, **darf nicht entfernt oder reaktiviert werden** (Nutzerentscheidung). Die Analyse der frühen Versionen (v1.0.0–v1.0.18) ist in den historischen ANALYSE-Dateien dokumentiert.

**Codestellen (v1.0.50):** `getVisitorData()` (Z. 850), `fetchAndroidVrPlayer()` (Z. 867), `extractStreams()` (Z. 986), `downloadUrl()` (Z. 378), `mergeFmp4()` (Z. 664), `pickMergeAudio()` (Z. 774), `runDownload()` (Z. 1708).

### 3.2 Bibliothek/Werkzeug
**Keine** (yt-dlp/pytube/ffmpeg werden NICHT verwendet). Der DASH-Merge ist ein **bibliotheksfreies fMP4-Box-Merging** (`mergeFmp4`, seit v1.0.33): beide YouTube-DASH-Streams sind fMP4 (ftyp + moov(mvhd,mvex,trak) + moof/mdat-Segmente); der Merge baut EINE moov mit beiden traks (Audio-track_id 1→2), patcht alle Audio-tfhd und konkateniert Video- + Audio-Segmente. ffmpeg.wasm ist durch die YouTube-CSP (worker-src) blockiert — deshalb der eigene Merger.

### 3.3 Download-Button im UI
- **Position (v1.0.43, Deckkraft v1.0.48):** kleines, dezentes Overlay **unten rechts im Player** (`.xyt-dl-overlay`, 74×23 px, z-index 9999); auf /watch bevorzugt in der Action-Leiste `#top-level-buttons-computed`. Deckkraft: 60 % (`.6`) NUR im Overlay-Modus (Button über dem Video), volle Deckkraft in der Leiste, 100 % bei Hover.
- **Timing:** YouTube rendert die Leiste verzögert → bis zu 4 s Wartezeit (`BAR_WAIT_MS`), dann Player-Fallback über dem **ersten sichtbaren** Element (`#movie_player` kann 0×0 sein → Kandidaten-Schleife).
- **Klick-Handling:** Event-Delegation am `document` (capture-Phase) — überlebt SPA-Neu-Rendering.
- **Shorts (v1.0.41/v1.0.44):** `getVideoId()` erkennt `/shorts/<id>` aus dem URL-Pfad; `findAnchor()` wählt per `isElementInViewport` den **aktiven** Short-Player (gepufferte alte Shorts bleiben per transform im DOM → ohne Viewport-Check hinge der Button am falschen Short). `btnVideoId`-Tracking erzwingt Neu-Platzierung bei jedem Shorts-Wechsel.
- **Panel:** `position:fixed`-Overlay, per Maus verschiebbar (Drag), Positionierung erst nach Anzeige, Trusted-Types-sicher (`replaceChildren()` statt `innerHTML`).

### 3.4 Fortschrittsbalken
- **Echter, statischer Balken** 0→100 % (keine Animation, kein Sweep — `transition`/`margin-left` sind experimentell ausgeschlossen, da sie die Füllung in Yandex einfrieren).
- **Manuelles Range-Chunking** (seit v1.0.20, `CHUNK_SIZE` 4 MB): Yandex-`onprogress` mit `arraybuffer` ist nicht inkrementell (ein einzelner Event mit fast komplettem `loaded`) → eigene `received`-Zählung je Chunk (Status 206).
- **Größenermittlung:** HEAD `Content-Length` bevorzugt → Range-Probe (`Content-Range`) → `onprogress.total`; bei unbekannter Größe wächst der Balken statisch (kein %-Sprung).
- **Auto-Close:** nach erfolgreichem Download 2,5 s.
- **DASH-Merge-Fortschritt:** paralleles Laden von Video+Audio, Prozent über die Summe beider Streams.

### 3.5 Downloadgröße — Ermittlung und Darstellung
- Die ANDROID_VR-Antwort liefert `contentLength` für DASH-Streams (Video/Audio) → exakte Größenanzeige im Panel (`formatBytes`).
- Progressive Formate (itag 18) haben oft **kein** `contentLength` → Größen-Probe per Range-Request beim Downloadstart; ohne Ergebnis MB-Anzeige ohne Prozent (ehrliche Anzeige, nie 100 % vor Datei-Ende).
- Größencheck nach Abschluss: Abweichung erwartet vs. tatsächlich wird geloggt (`DL-FERTIG`).

---

## 4. Fehleranalyse: Chronologie der behobenen Ursachen (v1.0.0 → v1.0.50)

Vollständige, detaillierte Chronologie mit Codestellen und Tests: siehe **BERICHT.md** (§1–§21). Kurzfassung der wichtigsten Meilensteine:

| Version | Fix / Feature |
|---|---|
| v1.0.1–1.0.2 | Event-Delegation + Einzel-Instanz-Schutz; Trusted-Types (`replaceChildren`) |
| v1.0.3 | Panel-Positionierung (erst anzeigen, dann messen) |
| v1.0.5–1.0.14 | Fortschrittsbalken-Kette (indet, MB-Modus, Range-Probe, arraybuffer, kein Sweep) |
| v1.0.19 | **Primärer Pfad: ANDROID_VR-Innertube-Client** (direkte googlevideo-URLs); savenow/dubs.io → deaktivierter Fallback |
| v1.0.20 | Manuelles Range-Chunking (Yandex-onprogress nicht inkrementell) |
| v1.0.21 | LOGIN_REQUIRED-Fix (Visitor-ID, Origin, Referer, contentPlaybackContext) |
| v1.0.33 | **DASH-Merge clientseitig** (`mergeFmp4`, ffmpeg.wasm durch CSP blockiert) |
| v1.0.40 | **Flaches Panel**: EINE Liste 360p→2160p, keine Kategorien/Ton-Suffixe, jeder Klick mit Ton |
| v1.0.41 | **Shorts-Unterstützung** (/shorts/<id>, Player-Overlay, `res`-basierte Auflösung) |
| v1.0.42 | Code-Optimierung (dbg(), Panel-Refs gecacht, Observer gedrosselt, sync-try/catch) |
| v1.0.43 | **Button unten rechts** im Player (dezentes Overlay, 74×23 px) |
| v1.0.44 | **Shorts-Scrolling**: Button bei JEDEM Short (btnVideoId + isElementInViewport) |
| v1.0.45 | **Korrekte Dateinamen** bei Shorts (Titel aus frischer ANDROID_VR-Antwort statt stale ytInitialPlayerResponse) |
| v1.0.46 | **Veröffentlichung** als „xYTDownloader" (Greasy Fork + Reddit), engl. Metablock/Kommentarkopf |
| v1.0.47/48 | Button-Deckkraft: 60 % NUR über dem Video (Overlay-Modus), Leiste 100 %, Hover 100 % |
| v1.0.49 | **Sicherheits-Update**: API-Key (savenow-Fallback) → Platzhalter in allen öffentlichen Quellen; **GitHub-Repo** erstellt |
| v1.0.50 | **Bugfix**: pickMergeAudio verwirft WEBM/Opus-Audio beim DASH-Merge (vorher kaputte Datei); DL-URL-PARAMS-Präzedenz |

**Bekannte Restpunkte (kein offener Bug):** progressives 720p existiert über ANDROID_VR nicht (nur itag 18 = 360p/240p) — höhere Auflösungen laufen automatisch über den DASH-Merge. WEBM/Opus-Audio wird nicht gemerged (MP4-Container; `pickMergeAudio` wählt MP4/AAC, itag 140 bevorzugt).

---

## 5. Testnachweise (Überblick)

Aktuelle Real-Tests (Playwright + echter ANDROID_VR-Request) je Version: siehe **BERICHT.md** pro Abschnitt. Zusammengefasst für v1.0.40–v1.0.50:

| Version | Kern-Tests (alle grün) |
|---|---|
| v1.0.40 | Flaches Panel (6 Einträge), 360p-Download 100 %, 720p-Merge real bis 82 % (Netzwerk-Abbruch im Test, Logik seit v1.0.33 verifiziert) |
| v1.0.41 | Shorts-Button/Panel/Download, /watch-Regression, SPA-Wechsel |
| v1.0.42 | Gesamttest: /watch (Panel, 360p 100 %, 720p-Merge), /shorts, SPA beide Richtungen |
| v1.0.43 | Button-Position unten rechts (bottom/right 10 px, 74×23 px) auf /watch + /shorts |
| v1.0.44 | Shorts S1→S2→S3 (Button im neuen Player, 1×, kein Doppel), /watch-Leiste stabil |
| v1.0.45 | Dateinamen: Short 1 → eigener Titel, Short 2 → neuer Titel (real per Status „Download abgeschlossen") |
| v1.0.46 | Veröffentlichung real: Greasy-Fork-Seite (v1.0.46) + Reddit-Post online |
| v1.0.47/48 | Button-Deckkraft: 60 % NUR über dem Video (Overlay-Modus), Leiste 100 %, Hover 100 % — real per getComputedStyle |
| v1.0.49 | Sicherheits-Update: API-Key → Platzhalter in allen öffentlichen Quellen; GitHub-Repo erstellt |
| v1.0.50 | Bugfix-Test: nur-webm → kein Merge (null); gemischt → itag 140 (unverändert); E2E-Panel intakt |

**Testvideos:** `dQw4w9WgXcQ` (Rick, 4K), `vE-cOL98DPk` (Short, funktioniert), `aXzVB3nT_3M` (Short, YouTube meldet „nicht verfügbar" — kein Script-Bug).

---

## 6. Veröffentlichung (v1.0.50)

| Ziel | URL | Status |
|---|---|---|
| Greasy Fork | https://greasyfork.org/de/scripts/589972-xytdownloader | ✅ veröffentlicht (online v1.0.49, lokaler Build v1.0.50 — Upload ausstehend, Konto `immerzu`) |
| Install-Link | https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js | ✅ |
| GitHub-Repo | https://github.com/immerzu/xYTDownloader-userscript | ✅ öffentlich (Branch main, 2 Commits) |
| Reddit r/userscripts | https://www.reddit.com/r/userscripts/comments/1vg0oiz/script_xytdownloader_oneclick_youtube_downloader/ | ✅ veröffentlicht |
| ru-board forum 25 | https://forum.ru-board.com/topic.cgi?forum=25&topic=7181 | ✅ veröffentlicht (Account IgorRolf) |

**Künftige Updates (Greasy Fork):** Version im Metablock höher anheben (nie dieselbe Version zweimal), dann `https://greasyfork.org/de/scripts/589972/versions/new` (Skill `greasy-fork-publish`, FileReader-Trick, Changelog EN/DE).

---

## 7. Dateien-Inhalte

- **Volltext der Arbeitsversion:** siehe `xyt-downloader.user.js` (1930 Zeilen, ~88,6 KB) und identisch `Ausgabe\xyt-downloader-v1.0.50.user.js` (cmp-verifiziert, MD5 `96854c59c67a3bb5d6abbc6a581f3a40`, API-Key = Platzhalter).
- **BERICHT.md:** vollständige Projektdoku (Erfolgskriterien, Loop, Fixes v1.0.0–v1.0.50, §1–§25).
- **README.md:** Repo-README, dreisprachig (EN/DE/RU).
- **ANALYSE_JD2_YOUTUBE.md / ANALYSE_DISKREPANZ_PLAYWRIGHT_VS_YANDEX.md:** historische Analysen (Basis v1.0.18 bzw. v1.0.25) — dokumentieren den damaligen Stand, nicht aktualisiert.
- **Referenz-Script (`…-2.5.txt`, 267 KB):** fremd (GreasyFork, MIT), nur historische API-Parameterquelle für den deaktivierten Fallback; wird nicht ausgeliefert.
- `.playwright-mcp/` und `.reasonix/`: automatisch generiert, nicht projektrelevant.

---

## 8. Git-Status

**Git-Repository vorhanden (seit 2026-08-05).** Remote: `https://github.com/immerzu/xYTDownloader-userscript` (öffentlich, Branch `main`). Erster Commit: `2386771` („xYTDownloader v1.0.48 …"). 7 Dateien im Repo: `.gitignore`, `README.md` (dreisprachig EN/DE/RU), `xyt-downloader.user.js` (API-Key = Platzhalter `HIER_API_KEY_EINFUEGEN`), `AGENTS.md`, `BERICHT.md`, `DOKUMENTATION_ENTWICKLUNGSSTAND.md`, `ANALYSE_*.md`. Versionierung zusätzlich über die `@version`-Zeile im Metablock + Build-Dateien in `Ausgabe\` (lokal, nicht im Repo).

---

## 9. Wichtigste Konventionen / offene Punkte für die Weiterarbeit

- **Build-Regel (verbindlich):** Neuer Build → nach `Ausgabe\`, `@version` UND `MY_VERSION` anheben (nie dieselbe Version zweimal), Dateiname `xyt-downloader-v<version>.user.js`; Arbeitsversion bleibt `xyt-downloader.user.js` im Stamm; per `cmp` + `md5sum` verifizieren; BERICHT.md pro Build aktualisieren.
- **Kein Commit/Push/Deployment per Git** (kein Repo vorhanden); Veröffentlichung nur über Greasy Fork (Nutzer-Freigabe).
- **savenow/dubs.io-Fallback-Code deaktiviert lassen**, nie reaktivieren (Nutzerentscheidung).
- **Offen (Design-Entscheidungen, nicht beauftragt):** progressives 720p+ gibt es über ANDROID_VR nicht (DASH-Merge ist der Weg); WEBM/Opus-Merge wird nicht unterstützt.
- **Bekannte Einschränkungen:** age-restricted/private Videos, Livestreams nicht verarbeitbar; `youtu.be`-Kurzlinks nicht abgedeckt (nur /watch und /shorts); API-Key des deaktivierten Fallbacks liegt offen im Script.
