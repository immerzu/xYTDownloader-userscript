# AGENTS.md — xYTDownloader

Tampermonkey-Userscript: YouTube-Download-Button mit Qualitätsauswahl, DASH-Merge und Fortschrittsbalken.

## Build-Regeln (bindend)

- Arbeitsversion: `xyt-downloader.user.js` (Projektstamm) — dort werden Änderungen gemacht.
- Jeder neue Build: Version in `@version` (Metablock) **und** `MY_VERSION` (Z. 76) anheben — **nie dieselbe Version zweimal** ausliefern.
- Build nach `Ausgabe\xyt-downloader-v<version>.user.js` kopieren (alte Builds bleiben erhalten), per `cmp` + `md5sum` verifizieren.
- `BERICHT.md` pro Build mit neuem Abschnitt aktualisieren.
- **Git-Repo vorhanden** (seit 2026-08-05): `immerzu/xYTDownloader-userscript` auf GitHub. Commits/Pushes sind ERLAUBT und erwünscht (nur keine sensiblen Daten hochladen — API-Key bleibt Platzhalter). **GitHub-Release pro Version** (seit v1.0.76): Git-Tag `v<version>` + `gh release create` mit `Ausgabe/xyt-downloader-v<version>.user.js` als Asset (Details im Skill `greasy-fork-publish`, Ablauf C).
- **R8/Minify: immer verboten** (nicht zutreffend hier, aber projektübergreifende Regel).
- savenow.to/dubs.io-Fallback-Code (`DEAKTIVIERTER FALLBACK-PFAD`, Z. 1182) **deaktiviert lassen**, nie reaktivieren.

## Architektur

- `getVideoId()` (Z. 224): `?v=`-Param → `/shorts/<id>`-Pfad → PlayerResponse. Rückgabe: reine Video-ID.
- `fetchAndroidVrPlayer(videoId)` (Z. 1000): `POST youtubei/v1/player`, Client `VISIONOS` (Name 1.02, RealityDevice17,1) — liefert signierte googlevideo-URLs **ohne POT-Token** (Hauptpfad). Seit v1.0.71–76 statt ANDROID_VR (der lieferte 403/UNPLAYABLE).
- `extractStreams(pr)`: liefert `{progressive, videoOnly, audioOnly, video}` — `video` = flache Liste ≥360p, dedupliziert pro **`s.res`** (Label-Auflösung; bei Shorts ist `height` die lange Hochkant-Seite!), beste Codecs avc1 > vp9 > av01, absteigend.
- `downloadUrl()` (Z. 454): manuelles 4-MB-Range-Chunking (`CHUNK_SIZE`), eigene `received`-Zählung (Yandex-`onprogress` ist nicht inkrementell), Blob → `<a download>`.
- `runDownload(kind, stream, …)` (Z. 1892): direkt bei progressiv; DASH-videoOnly → automatischer Merge mit bestem Audio-Stream (`pickMergeAudio`, Z. 894, itag 140 bevorzugt).
- `mergeFmp4()` (Z. 784): bibliotheksfreies fMP4-Box-Merging (ftyp + moov mit 2 traks + moof/mdat-Segmente; ffmpeg.wasm ist durch YouTube-CSP blockiert).
- `downloadStreamBytes()` (Z. 627): `&range=` URL-Parameter statt Range-Header (Range-Header → 403), googlevideo-Referer, init-Segment (ftyp+moov) separat laden (Z. 1136 `normalize` setzt initRange).
- Injektion: `findAnchor()`/`attachButton()` — Leiste `#top-level-buttons-computed`, 4 s Wartezeit (`BAR_WAIT_MS`, Z. 1524), dann Player-Fallback über dem **ersten sichtbaren** Element (`#movie_player` kann 0×0 sein! Kandidaten-Schleife).
- SPA: `/(watch|shorts|live)/`-Erkennung in `refresh()`, 1,5-s-Intervall, MutationObserver, pushState/replaceState-Override.

## Tests (Playwright, `.playwright-mcp\`)

- Real-Tests mit echtem ANDROID_VR-Request via GM-Shims (`GM_xmlhttpRequest`-Brücke, fetch an youtubei).
- Testvideos: `dQw4w9WgXcQ` (Rick, 4K), `vE-cOL98DPk` (Short, funktioniert), `aXzVB3nT_3M` (Short, YouTube meldet „nicht verfügbar" — kein Script-Bug).
- Syntax: `node --check xyt-downloader.user.js`.
- Console-Logs mit `[xYT]`-Präfix (Ede nutzt Yandex + Tampermonkey; Verifikation über F12-Konsole: `[xYT] Script geladen v<version>`, `[xYT] URL: …`, `[xYT] Instanz-Flag: …`).

## Grenzen

- `@connect` explizit (Wildcards unzuverlässig in Yandex): `p.lbserver.xyz`, `*.lbserver.xyz`, `*.googlevideo.com` u. a.
- Kurzlinks (youtu.be/…) sind nicht abgedeckt (nur /watch-, /shorts- und /live-Seiten).
- Livestreams: echte Live-Übertragungen sind nicht herunterladbar (erkennbar via `isLivePlayerResponse`, Z. 872); beendete Livestreams (VODs) mit progressiven Formaten funktionieren.

## Veröffentlichung (Stand v1.0.79)

- Greasy Fork: https://greasyfork.org/de/scripts/589972-xytdownloader (Name „xYTDownloader", Skript-ID 589972; **online v1.0.79**, Konto `immerzu`)
- **GF-Validierung (bindend, seit v1.0.78):** `@description` **max. 500 Zeichen** (aktuell 402) UND **`@description:de`-Zeile Pflicht** (aktuell 226) — ohne beides schlägt der Upload fehl und das Skript erscheint NICHT auf der deutschen by-site-Seite (`/de/scripts/by-site/youtube.com`). Auch `@name:de` gesetzt (seit v1.0.77).
- **Webhook-Auto-Update: verifiziert funktionierend** (v1.0.76 vom 27.08. kam per Webhook — GF-Versions-Zeitstempel 16:17 MESZ = Delivery 14:17:07Z, 19 s nach Commit). **Achtung: Der Webhook-Pfad validiert NICHT** (übernimmt Roh-Code, auch @description > 500 Zeichen ohne @description:de). Der GF-Admin zeigt „Letzte erfolgreiche Synchronisierung" nur für den manuellen Sync — nicht für Webhook-Übernahmen. **Für saubere GF-Validierung: manuellen Upload bevorzugen** (https://greasyfork.org/de/scripts/589972/versions/new, Skill `greasy-fork-publish`, Ablauf A, FileReader-Trick).
- Install-Link: https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js
- GitHub-Repo: https://github.com/immerzu/xYTDownloader-userscript (öffentlich, Branch main)
- GitHub-Releases: https://github.com/immerzu/xYTDownloader-userscript/releases (Tag `v<version>` + Asset `Ausgabe/xyt-downloader-v<version>.user.js`, seit v1.0.76)
- Reddit-Post: https://www.reddit.com/r/userscripts/comments/1vg0oiz/script_xytdownloader_oneclick_youtube_downloader/
