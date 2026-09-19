# HANDOVER — xYTDownloader (Stand: 2026-09-19, v1.0.91)

> Aktueller Einstieg. Das ältere `HANDOVER_v1.0.70.md` ist **historisch** (Stand 2026-08-09).

## 1. Wo das Projekt steht
- **Arbeitsstand:** `xyt-downloader.user.js` = **v1.0.91** (1895 Zeilen), `@version` und `MY_VERSION` (Z. 69) synchron.
- **Veröffentlicht:** Greasy Fork **live v1.0.91** (Auto-Sync, Übernahme 2026-09-19T07:42:48Z); GitHub-Commit `f648d88` auf `main`, Tag/Release `v1.0.91` mit Asset.
- **Build:** `Ausgabe\xyt-downloader-v1.0.91.user.js` (MD5 `3c79ce9efc376cc43d05da3095976ea0`).
- **Verifiziert:** im portablen Firefox des Nutzers (Download läuft) + GF-Sprachsuchen DE/RU zeigen die lokalisierten Kurzbeschreibungen.
- Details der letzten Änderung: `BERICHT.md` §57; Kernwissen: `memory\FACT.md` (Erkenntnis **1e**).

## 2. Was in der Sitzung vom 2026-09-19 passiert ist
1. **Nutzer-Fehlerbild (Firefox):** Panel „Video: 360p" → „Video + Audio werden geladen und zusammengeführt …" → **„Fehler: leere Chunk-Antwort (Status 0)"**.
2. **Ursache gefunden (bewiesen):** `fetchRangeChunk` setzte einen **`User-Agent`**-Header. In **Firefox** ist dieser seit FF 43 nicht mehr forbidden → er wird gesendet → als Nicht-Safelisted Header erzwingt er einen **CORS-Preflight**, den googlevideo ablehnt (gemessen: mit `user-agent` keine `Access-Control-Allow-Origin`; mit `range` erlaubt). **Chromium verwirft den UA-Header still** ([crbug 571722](https://crbug.com/571722)) → in Yandex/Chrome lief es immer. `Referer`/`Accept-Encoding` waren ohnehin forbidden (kamen nie an).
3. **Fix v1.0.91:** keine Custom-Header mehr im Chunk-Fetch; zusätzlich wird die fetch-Fehlerursache geloggt und an die Panel-Meldung angehängt (vorher stand nur „Status 0" ohne Anhaltspunkt).
4. **Veröffentlicht** (Push → Webhook → GF), Doku in BERICHT §57 + FACT 1e.
5. **Nebenbei entstanden:** GF-Antwort-Tool `gf-reply.mjs` (inkl. Login-Erkennungs-Lektion) und die CORS-/Stream-Probe-Tools in `C:\Users\lolo\.dsh\browser-tools\`.

## 3. Offene Punkte (nächste sinnvolle Schritte)
1. **GF-Diskussion 339057 („Spok", Android 5.1 + Via):** Wiedergabe dort ist ein Umgebungsproblem (nicht lösbar per Userscript); für den Download fehlen seine Angaben (Installationsweg in Via, Panel-Verhalten, `[xYT]`-Logs). Die Firefox-Erklärung aus 1e passt auf „Desktop: Download startet nicht" — ggf. als Antwort nachreichen.
2. **Via-/GM-lose Umgebungen:** obsoletes `typeof GM_xmlhttpRequest`-Gate in `downloadUrl` (Z. 354) entfernen/entschärfen, damit native fetch-Chunks auch ohne GM-APIs laufen.
3. **Timeout in `fetchAndroidVrPlayer`** ergänzen (sonst ewiges „Formate werden geladen …").
4. **Merge-Pfad** bei Status 0 robuster (z. B. eine Wiederholung mit frischer URL oder klare Handlungsempfehlung im Panel).

## 4. Arbeitsweise in diesem Projekt (Kurzfassung)
- Änderung → `node --check` → Version in `@version` **und** `MY_VERSION` (Z. 69) heben → Build nach `Ausgabe\` + `cmp`/MD5 → `BERICHT.md`-Abschnitt → Commit/Push (`main`) → GF-Sync **messen** (`https://api.greasyfork.org/scripts/589972.json`) + GF-Display-Check DE/EN/RU → GitHub-Release mit Asset.
- **Vor Veröffentlichung den Nutzer fragen**; Commits/Pushes sind danach erwünscht.
- Metablock: `@description` (EN, GF-Skript-Locale) + `@description:de` + `@description:ru`, je ≤ 500 Zeichen; keine `@name:xx` ohne `@description:xx`.
- **Firefox-Tests macht ausschließlich der Nutzer** (keine Automatisierung möglich); Chromium-Tests über `reasonix-profil`.
- Vollständige Regeln: `AGENTS.md`; Wissen/Erkenntnisse: `memory\FACT.md`; Build-Chronik: `BERICHT.md`.
