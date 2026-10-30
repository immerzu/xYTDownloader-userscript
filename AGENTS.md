# AGENTS.md — xYTDownloader

Tampermonkey-Userscript: YouTube-Download-Button mit Qualitätsauswahl, DASH-Merge und Fortschrittsbalken.

## Build-Regeln (bindend)

- Arbeitsversion: `xyt-downloader.user.js` (Projektstamm) — dort werden Änderungen gemacht.
- Jeder neue Build: Version in `@version` (Metablock) **und** `MY_VERSION` (Z. 69) anheben — **nie dieselbe Version zweimal** ausliefern.
- Build nach `Ausgabe\xyt-downloader-v<version>.user.js` kopieren (alte Builds bleiben erhalten), per `cmp` + `md5sum` verifizieren.
- **Namensschema ausnahmslos (seit v1.0.93, 2026-10-17):** Jede Fassung — auch eine unveröffentlichte Test-/Vorabversion — erhält eine **fortlaufende reguläre Version** und liegt als `Ausgabe\xyt-downloader-v<version>.user.js`. Keine Sonderformen wie `-TEST-<datum>`. `@version`, `MY_VERSION` und Dateiname tragen dieselbe Nummer; unveröffentlichte Fassungen bleiben lokal (kein Commit/Release bis zur Nutzerfreigabe).
- **Versionszweig (ab 2026-10-18, Nutzeranweisung):** Die **nächste** neue Fassung nach v1.0.100 beginnt bei **1.1.00** und zählt dort weiter (1.1.01, 1.1.02 …). Nicht wieder auf 1.0.xx zurückfallen; v1.0.100 bleibt der Abschluss des 1.0-Zweigs.
- `BERICHT.md` pro Build mit neuem Abschnitt aktualisieren.
- **Git-Repo vorhanden** (seit 2026-08-05): `immerzu/xYTDownloader-userscript` auf GitHub. Commits/Pushes sind ERLAUBT und erwünscht (keine sensiblen Daten/Secrets hochladen — Secret-Prüfung vor jedem Upload, s. Skill `greasy-fork-publish`). **GitHub-Release pro Version** (seit v1.0.76): Git-Tag `v<version>` + `gh release create` mit `Ausgabe/xyt-downloader-v<version>.user.js` als Asset (für GF irrelevant — reine Projekt-Doku).
- **R8/Minify: immer verboten** (nicht zutreffend hier, aber projektübergreifende Regel).
- savenow.to/dubs.io-Fallback-Code ist **seit v1.0.82 vollständig aus dem Script entfernt** (inkl. @connect) — **nie wieder einbauen**.

## Architektur

- `getVideoId()` (Z. 175): `?v=`-Param → `/shorts/<id>`-Pfad → PlayerResponse. Rückgabe: reine Video-ID.
- `fetchAndroidVrPlayer(videoId, externalSignal)` (Z. 1654): `POST youtubei/v1/player`, Client `VISIONOS` (Name 1.02, RealityDevice17,1) — liefert signierte googlevideo-URLs **ohne POT-Token** (Hauptpfad). Seit v1.0.71–76 statt ANDROID_VR (der lieferte 403/UNPLAYABLE). **Seit v1.0.94 mit 15-s-Timeout (`AbortController`) und externem Abbruchsignal**; seit v1.1.17 prüft die Antwort Status, Typ und Größe.
- `fetchRangeChunk(url, start, end, signal, options)` (Z. 539): der eigentliche Stream-Fetch — `&range=`/`&ratebypass=` in der URL. **Seit v1.0.91 ohne Custom-Header** (ein `User-Agent`-Header löste in Firefox einen CORS-Preflight aus → Status 0; Chromium verwirft ihn still — FACT 1e). **Seit v1.1.17:** `safeMediaUrl` (nur HTTPS auf `googlevideo.com`), `readResponseLimited` (kleine Range-Antworten begrenzt einlesen) und `validateRangeResponse` (Status, Start, Ende, Länge und Gesamtgröße gemeinsam).
- `extractStreams(pr)` (Z. 1815): liefert `{progressive, videoOnly, audioOnly, video}` — `video` = flache Liste ≥360p, dedupliziert pro **`s.res`** (Label-Auflösung; bei Shorts ist `height` die lange Hochkant-Seite!), beste Codecs avc1 > vp9 > av01, absteigend.
- `downloadUrl(url, filename, expectedSize, signal)` (Z. 591): progressiver Pfad mit 4-MB-Range-Chunks (`CHUNK_SIZE` Z. 409), eigener `received`-Zählung (Yandex-`onprogress` ist nicht inkrementell), Größenprobe und Blob → `<a download>`. **Seit v1.0.93 ohne GM-Gate** (das alte `typeof GM_xmlhttpRequest`-Relikt ist entfernt) und mit Netz-Wiederholungen vor dem `GM_download`-Fallback (`fallbackDownload` Z. 800).
- `downloadStreamBytes(url, expectedSize, onProgress, refreshInfo, initRange, signal)` (Z. 850): Chunked-Download für den DASH-Merge; `initRange`/`indexEnd` (in `extractStreams.normalize` gesetzt) wird als init-Segment vorangestellt. Bei 403/416 → frische URL über `refreshUrl()`; **seit v1.0.93** werden Status 0/429/5xx bis zu 4× mit Wartezeit (1/2/4/8 s) wiederholt (`retryChunk`, Z. 871). **Seit v1.1.07–1.1.10** gelten HTTP 200/206 nur nach vollständiger Bereichsprüfung (200 nur am Dateianfang bzw. bei exakter Range-Länge).
- `runDownload(kind, stream, label, videoId, title, mergeAudio)` (Z. 2596): direkt bei progressiv; DASH-videoOnly → automatischer Merge mit bestem Audio-Stream (`pickMergeAudio`, Z. 1580, nur MP4-Audio). Größen-Guard vor dem Start (`MAX_BUFFER_BYTES` 1,9 GB, Z. 414). **Seit v1.1.14** bei großen/speicherkritischen Dateien Streaming-Merge über `streamMergeToOpfs()` (Z. 1508, OPFS, Web Locks ab v1.1.16) statt RAM-Puffer.
- `mergeFmp4()` (Z. 1080): bibliotheksfreies fMP4-Box-Merging (ftyp + moov mit 2 traks + moof/mdat-Segmente; ffmpeg.wasm ist durch YouTube-CSP blockiert). Liefert seit v1.1.13 einen `Blob`; die Streaming-Variante baut den Kopf über `buildMergeHeader()` (Z. 1285).
- Injektion: `getBar()` (Z. 2159, bevorzugt die Leiste in der **sichtbaren `ytd-watch-metadata`**, sonst erste gefüllte sichtbare — YouTube hat mehrere `#top-level-buttons-computed`!) / `findAnchor()` (Z. 2183) / `insertIntoBar()` (Z. 2226, vor „Speichern") / `attachButton()` (Z. 2244) — 4 s Wartezeit (`BAR_WAIT_MS` Z. 2110, Anker `barWaitStart` Z. 2115 je Video), dann Player-Fallback über dem **ersten sichtbaren** Element (`#movie_player` kann 0×0 sein! Kandidaten-Schleife). Seit v1.0.95 wird der Button bei Video-Wechsel aus dem DOM gelöst.
- SPA: `/(watch|shorts|live)/`-Erkennung in `refresh()` (Z. 2902), 1,5-s-Intervall, MutationObserver, pushState/replaceState-Override.

## Tests

- **Syntax:** `node --check xyt-downloader.user.js` (vor jedem Build).
- **Chromium-Tests** (Playwright; Chrome for Testing 153, Profil `C:\Users\lolo\AppData\Local\Google\Chrome for Testing\User Data`, Config `C:\Users\lolo\.dsh\playwright-mcp-config.json`): Real-Tests mit echtem VISIONOS-Request via GM-Shims bzw. `yt-stream-probe.mjs` / `yt-cors-probe.mjs` (CORS-/Preflight-Messung). Das frühere Profil `reasonix-profil` existiert nicht mehr (Stand 2026-10-17).
- **Firefox kann NICHT automatisiert werden:** `playwright-core` steuert nur den gepatchten playwright-Firefox-Build, nicht den normalen Firefox; der geckodriver-Download ist in dieser Umgebung blockiert (GitHub-Release-URLs). → **Firefox-Tests macht der Nutzer** (portabler Firefox 155.0.1, Tampermonkey) — Fix ausliefern, Nutzer bestätigt.
- Testvideos: `dQw4w9WgXcQ` (Rick, 4K), `vE-cOL98DPk` (Short, funktioniert), `aXzVB3nT_3M` (Short, YouTube meldet „nicht verfügbar" — kein Script-Bug).
- Console-Logs mit `[xYT]`-Präfix (Ede nutzt Yandex + Firefox + Tampermonkey; Verifikation über F12-Konsole: `[xYT] Script geladen v<version>`, `[xYT] URL: …`, `[xYT] Instanz-Flag: …`, bei Downloads `DL-START`/`DL-CHUNK-REQ`/`fetch fehlgeschlagen …`).
- Skill für Browser-Automation: `playwright-browser`; GF-Tools: `greasy-fork-publish` (inkl. `gf-reply.mjs` für Diskussionsantworten).

## Grenzen

- `@connect` explizit: nur noch `googlevideo.com` + `*.googlevideo.com` (savenow/lbserver/dubs-@connect seit v1.0.82 entfernt).
- Kurzlinks (youtu.be/…) sind nicht abgedeckt (nur /watch-, /shorts- und /live-Seiten).
- Livestreams: echte Live-Übertragungen sind nicht herunterladbar (erkennbar via `isLivePlayerResponse`, Z. 1641); beendete Livestreams (VODs) mit progressiven Formaten funktionieren.

## Veröffentlichung (Stand v1.1.17)

- Greasy Fork: https://greasyfork.org/de/scripts/589972-xytdownloader (Name „xYTDownloader", Skript-ID 589972; **online v1.1.17**, Konto `immerzu`)
- **Stand 2026-10-22:** v1.1.17 ist veroeffentlicht (GitHub-Commit `f4cb9ab`, Release `v1.1.17`, GF-Sync automatisch ueber `main`; GF-Übernahme 2026-10-22T10:12:47Z). v1.1.16 und v1.1.15 bleiben als Vorversionen erhalten; v1.1.00-v1.1.14 sind lokale Zwischenstaende ohne eigene Releases.
- **GF-Sprachfilter (bindend, seit v1.0.90):** Die GF-Suche filtert standardmäßig nach Sprache — ein Skript ist nur in Sprachen auffindbar, für die lokalisierte Beschreibungen existieren. Deshalb ist die Kurzbeschreibung **lokalisiert**: `@description` = **englische** Kurzbeschreibung (Default; entspricht der GF-Skript-Locale `en` von xYT) + `@description:de` + `@description:ru` (je eine Zeile). **Kein** `@description:en` (wird bei Skript-Locale `en` von GF ignoriert), **keine** `@name:xx`-Zeilen ohne passendes `@description:xx` (GF-Validierungsfehler „can't be blank"), keine kombinierten „DE / EN / RU"-Mischtext-Zeilen (machen das Skript nur in EINER Sprache auffindbar). Begründung + Quellcode-Belege: BERICHT §56, FACT-Erkenntnis 1d. Einzelne `@description`-Zeile bleibt ≤ 500 Zeichen (Upload-Hartgrenze).
- **Veröffentlichen = Ablauf C (Sync):** Änderung committen + auf `main` pushen; GF zieht `https://raw.githubusercontent.com/immerzu/xYTDownloader-userscript/main/xyt-downloader.user.js`. **Nicht auf den Webhook warten, sondern messen** und bei Bedarf den Admin-Trigger nachziehen (Skill `greasy-fork-publish`, Ablauf C: `gf-admin-sync.mjs`). Manueller Upload (`gf-publish.mjs version`) nur als Fallback.
- **Verifikation ohne Browser (Pflicht nach jedem Push):** `Invoke-RestMethod https://api.greasyfork.org/scripts/589972.json` (bzw. `https://greasyfork.org/scripts/589972.json`) → `version`, `code_updated_at` (Achtung: `web_fetch` auf `greasyfork.org/…json` scheitert an der Umleitung zu `api.greasyfork.org` — Adresse direkt angeben). **GF-Display-Check:** `/de/`, `/en/`, `/ru/`-Suche `?q=xytdownloader` → Skript vorhanden + sprachrichtige Kurzbeschreibung. Beleg v1.0.91: Übernahme 2026-09-19T07:42:48Z, DE-/RU-Suche ok. Beleg v1.0.92: Übernahme 2026-10-17T16:30:14Z (9 s nach Push), Quellcode-Abgleich 0 Abweichungen. Beleg v1.0.93: Übernahme 2026-10-17T16:56:04Z, Quellcode-Abgleich 0 Abweichungen. Beleg v1.0.95: Übernahme 2026-10-17T17:26:41Z (8 s nach Push), Quellcode-Abgleich 0 Abweichungen. Beleg v1.0.97: Übernahme 2026-10-17T17:45:20Z; `.meta.js` 1.0.97, `.user.js` 1.0.97 (Abgleich: nur Whitespace in den Update-Zeilen). Beleg v1.1.16: Übernahme 2026-10-18T07:16:35Z. Beleg v1.1.17: Übernahme 2026-10-22T10:12:47Z, Quellcode-Abgleich 0 Abweichungen (nur der `.meta.js`-CDN-Endpunkt lieferte zeitweise HTTP 503). **Achtung:** `user.js` kann nach dem Push kurz noch die Vorversion liefern (CDN, hier 17 s) — vor dem Codevergleich erneut abrufen.
- **GF-Diskussionsantworten** (Nutzer-Feedback): `node C:\Users\lolo\.dsh\browser-tools\gf-reply.mjs diag|reply --url <thread> --file <text>` (immerzu-Profil; Login-Erkennung nur über die Antwort-Textarea — Details FACT „Umgebung & Werkzeuge").
- Install-Link: https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js
- GitHub-Repo: https://github.com/immerzu/xYTDownloader-userscript (öffentlich, Branch main)
- GitHub-Releases: https://github.com/immerzu/xYTDownloader-userscript/releases (Tag `v<version>` + Asset `Ausgabe/xyt-downloader-v<version>.user.js`, seit v1.0.76; für GF irrelevant — reine Projekt-Doku). **Belegbar** existieren Releases ab `v1.0.88`; für v1.0.76–v1.0.87 wurden keine Releases angelegt.
- Reddit-Post: https://www.reddit.com/r/userscripts/comments/1vg0oiz/script_xytdownloader_oneclick_youtube_downloader/
