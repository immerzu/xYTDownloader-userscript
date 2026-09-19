# AGENTS.md — xYTDownloader

Tampermonkey-Userscript: YouTube-Download-Button mit Qualitätsauswahl, DASH-Merge und Fortschrittsbalken.

## Build-Regeln (bindend)

- Arbeitsversion: `xyt-downloader.user.js` (Projektstamm) — dort werden Änderungen gemacht.
- Jeder neue Build: Version in `@version` (Metablock) **und** `MY_VERSION` (Z. 69) anheben — **nie dieselbe Version zweimal** ausliefern.
- Build nach `Ausgabe\xyt-downloader-v<version>.user.js` kopieren (alte Builds bleiben erhalten), per `cmp` + `md5sum` verifizieren.
- `BERICHT.md` pro Build mit neuem Abschnitt aktualisieren.
- **Git-Repo vorhanden** (seit 2026-08-05): `immerzu/xYTDownloader-userscript` auf GitHub. Commits/Pushes sind ERLAUBT und erwünscht (keine sensiblen Daten/Secrets hochladen — Secret-Prüfung vor jedem Upload, s. Skill `greasy-fork-publish`). **GitHub-Release pro Version** (seit v1.0.76): Git-Tag `v<version>` + `gh release create` mit `Ausgabe/xyt-downloader-v<version>.user.js` als Asset (für GF irrelevant — reine Projekt-Doku).
- **R8/Minify: immer verboten** (nicht zutreffend hier, aber projektübergreifende Regel).
- savenow.to/dubs.io-Fallback-Code ist **seit v1.0.82 vollständig aus dem Script entfernt** (inkl. @connect) — **nie wieder einbauen**.

## Architektur

- `getVideoId()` (Z. 175): `?v=`-Param → `/shorts/<id>`-Pfad → PlayerResponse. Rückgabe: reine Video-ID.
- `fetchAndroidVrPlayer(videoId)` (Z. 849): `POST youtubei/v1/player`, Client `VISIONOS` (Name 1.02, RealityDevice17,1) — liefert signierte googlevideo-URLs **ohne POT-Token** (Hauptpfad). Seit v1.0.71–76 statt ANDROID_VR (der lieferte 403/UNPLAYABLE). **Kein Timeout** (offener Punkt, s. FACT „Offene Punkte").
- `fetchRangeChunk(url, start, end)` (Z. 323): der eigentliche Stream-Fetch — `&range=`/`&ratebypass=` in der URL. **Seit v1.0.91 ohne Custom-Header** (ein `User-Agent`-Header löste in Firefox einen CORS-Preflight aus → Status 0; Chromium verwirft ihn still — FACT 1e).
- `extractStreams(pr)` (Z. 973): liefert `{progressive, videoOnly, audioOnly, video}` — `video` = flache Liste ≥360p, dedupliziert pro **`s.res`** (Label-Auflösung; bei Shorts ist `height` die lange Hochkant-Seite!), beste Codecs avc1 > vp9 > av01, absteigend.
- `downloadUrl()` (Z. 353): manuelles 4-MB-Range-Chunking (`CHUNK_SIZE` Z. 316), eigene `received`-Zählung (Yandex-`onprogress` ist nicht inkrementell), Blob → `<a download>`. **Achtung Relikt:** das `typeof GM_xmlhttpRequest`-Gate leitet in Umgebungen ohne GM-APIs (z. B. Via-eigene Skript-Engine) still in `fallbackDownload` (GM_download/`window.open`) — obsolet seit v1.0.71, s. FACT „Offene Punkte".
- `downloadStreamBytes()` (Z. 526): Chunked-Download für den DASH-Merge; `initRange`/`indexEnd` (in `extractStreams.normalize` gesetzt) wird als init-Segment vorangestellt. Bei 403/416 → frische URL über `refreshUrl()`; **Status 0 wird seit v1.0.91 mit Ursache geloggt**, hat aber weiterhin keinen Fallback (offener Punkt).
- `runDownload(kind, stream, …)` (Z. 1636): direkt bei progressiv; DASH-videoOnly → automatischer Merge mit bestem Audio-Stream (`pickMergeAudio`, Z. 796, itag 140 bevorzugt).
- `mergeFmp4()` (Z. 686): bibliotheksfreies fMP4-Box-Merging (ftyp + moov mit 2 traks + moof/mdat-Segmente; ffmpeg.wasm ist durch YouTube-CSP blockiert).
- Injektion: `findAnchor()` (Z. 1305) / `attachButton()` (Z. 1348) — Leiste `#top-level-buttons-computed`, 4 s Wartezeit (`BAR_WAIT_MS` Z. 1268), dann Player-Fallback über dem **ersten sichtbaren** Element (`#movie_player` kann 0×0 sein! Kandidaten-Schleife).
- SPA: `/(watch|shorts|live)/`-Erkennung in `refresh()` (Z. 1804), 1,5-s-Intervall, MutationObserver, pushState/replaceState-Override.

## Tests

- **Syntax:** `node --check xyt-downloader.user.js` (vor jedem Build).
- **Chromium-Tests** (Playwright, `.playwright-mcp\`, persistentes Profil `reasonix-profil`): Real-Tests mit echtem VISIONOS-Request via GM-Shims bzw. `yt-stream-probe.mjs` / `yt-cors-probe.mjs` (CORS-/Preflight-Messung).
- **Firefox kann NICHT automatisiert werden:** `playwright-core` steuert nur den gepatchten playwright-Firefox-Build, nicht den normalen Firefox; der geckodriver-Download ist in dieser Umgebung blockiert (GitHub-Release-URLs). → **Firefox-Tests macht der Nutzer** (portabler Firefox 155.0.1, Tampermonkey) — Fix ausliefern, Nutzer bestätigt.
- Testvideos: `dQw4w9WgXcQ` (Rick, 4K), `vE-cOL98DPk` (Short, funktioniert), `aXzVB3nT_3M` (Short, YouTube meldet „nicht verfügbar" — kein Script-Bug).
- Console-Logs mit `[xYT]`-Präfix (Ede nutzt Yandex + Firefox + Tampermonkey; Verifikation über F12-Konsole: `[xYT] Script geladen v<version>`, `[xYT] URL: …`, `[xYT] Instanz-Flag: …`, bei Downloads `DL-START`/`DL-CHUNK-REQ`/`fetch fehlgeschlagen …`).
- Skill für Browser-Automation: `playwright-browser`; GF-Tools: `greasy-fork-publish` (inkl. `gf-reply.mjs` für Diskussionsantworten).

## Grenzen

- `@connect` explizit: nur noch `googlevideo.com` + `*.googlevideo.com` (savenow/lbserver/dubs-@connect seit v1.0.82 entfernt).
- Kurzlinks (youtu.be/…) sind nicht abgedeckt (nur /watch-, /shorts- und /live-Seiten).
- Livestreams: echte Live-Übertragungen sind nicht herunterladbar (erkennbar via `isLivePlayerResponse`, Z. 836); beendete Livestreams (VODs) mit progressiven Formaten funktionieren.

## Veröffentlichung (Stand v1.0.91)

- Greasy Fork: https://greasyfork.org/de/scripts/589972-xytdownloader (Name „xYTDownloader", Skript-ID 589972; **online v1.0.91**, Konto `immerzu`)
- **GF-Sprachfilter (bindend, seit v1.0.90):** Die GF-Suche filtert standardmäßig nach Sprache — ein Skript ist nur in Sprachen auffindbar, für die lokalisierte Beschreibungen existieren. Deshalb ist die Kurzbeschreibung **lokalisiert**: `@description` = **englische** Kurzbeschreibung (Default; entspricht der GF-Skript-Locale `en` von xYT) + `@description:de` + `@description:ru` (je eine Zeile). **Kein** `@description:en` (wird bei Skript-Locale `en` von GF ignoriert), **keine** `@name:xx`-Zeilen ohne passendes `@description:xx` (GF-Validierungsfehler „can't be blank"), keine kombinierten „DE / EN / RU"-Mischtext-Zeilen (machen das Skript nur in EINER Sprache auffindbar). Begründung + Quellcode-Belege: BERICHT §56, FACT-Erkenntnis 1d. Einzelne `@description`-Zeile bleibt ≤ 500 Zeichen (Upload-Hartgrenze).
- **Veröffentlichen = Ablauf C (Sync):** Änderung committen + auf `main` pushen; GF zieht `https://raw.githubusercontent.com/immerzu/xYTDownloader-userscript/main/xyt-downloader.user.js`. **Nicht auf den Webhook warten, sondern messen** und bei Bedarf den Admin-Trigger nachziehen (Skill `greasy-fork-publish`, Ablauf C: `gf-admin-sync.mjs`). Manueller Upload (`gf-publish.mjs version`) nur als Fallback.
- **Verifikation ohne Browser (Pflicht nach jedem Push):** `Invoke-RestMethod https://api.greasyfork.org/scripts/589972.json` (bzw. `https://greasyfork.org/scripts/589972.json`) → `version`, `code_updated_at` (Achtung: `web_fetch` auf `greasyfork.org/…json` scheitert an der Umleitung zu `api.greasyfork.org` — Adresse direkt angeben). **GF-Display-Check:** `/de/`, `/en/`, `/ru/`-Suche `?q=xytdownloader` → Skript vorhanden + sprachrichtige Kurzbeschreibung. Beleg v1.0.91: Übernahme 2026-09-19T07:42:48Z, DE-/RU-Suche ok.
- **GF-Diskussionsantworten** (Nutzer-Feedback): `node C:\Users\lolo\.dsh\browser-tools\gf-reply.mjs diag|reply --url <thread> --file <text>` (immerzu-Profil; Login-Erkennung nur über die Antwort-Textarea — Details FACT „Umgebung & Werkzeuge").
- Install-Link: https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js
- GitHub-Repo: https://github.com/immerzu/xYTDownloader-userscript (öffentlich, Branch main)
- GitHub-Releases: https://github.com/immerzu/xYTDownloader-userscript/releases (Tag `v<version>` + Asset `Ausgabe/xyt-downloader-v<version>.user.js`, seit v1.0.76; für GF irrelevant — reine Projekt-Doku)
- Reddit-Post: https://www.reddit.com/r/userscripts/comments/1vg0oiz/script_xytdownloader_oneclick_youtube_downloader/
