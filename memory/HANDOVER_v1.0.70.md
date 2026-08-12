# HANDOVER — xYTDownloader (2026-08-09, v1.0.70)

## 1. AKTUELLER ENTWICKLUNGSSTAND

### Was funktioniert (getestet):
- 360p progressive Downloads (itag 18, mit Audio, Range-Chunking 4 MB)
- 720p/1080p DASH-Merge (videoOnly + audioOnly → fMP4-Merge client-seitig)
- /shorts/ URL-Unterstützung (ID aus Pfad, auflösungsbereinigt)
- /live/ URL-Unterstützung (beendete Livestreams / VODs)
- Livestream-Erkennung (isLive=true, DVR ohne Streams, hlsManifestUrl ohne Streams)
- SPA-Navigation (pushState/replaceState/MutationObserver)
- Dreisprachige Greasy-Fork-Beschreibung (@description + description.md)
- GitHub-Webhook → Greasy-Fork Auto-Update

### Architektur-Entscheidungen:
- **ANDROID_VR-Client als einziger API-Pfad** (keine savenow/dubs.io — deaktiviert!)
- **GM_xmlhttpRequest für Downloads** (Range-Chunking 4 MB) — die v1.0.49-Methode
- **KEIN pageFetch, kein unsafeWindow.fetch, kein GM_download** — alles Experimente, zurückgerollt
- **fMP4-Merge bibliotheksfrei** (ftyp+moov mit 2 traks + moof/mdat-Segmente)
- **Instanz-Schutz versioniert** (nur gleiche Version beenden, verwaiste Buttons entfernen)

### API-Key-Status:
- `API_KEY = 'HIER_API_KEY_EINFUEGEN'` (Platzhalter, savenow-Fallback DEAKTIVIERT)
- Echter Key existiert NUR in `Ausgabe\xyt-downloader-v1.0.48.user.js` (NICHT öffentlich!)

## 2. OFFENE AUFGABEN

- [ ] **Yandex-Tampermonkey-Korruptions-Check einbauen:** Das Script könnte prüfen ob GM_xmlhttpRequest funktioniert (Ping-Test), bevor es Fehlermeldungen anzeigt
- [ ] **Benchmark gegen JD2:** Systematisch vergleichen welche Videos mit unserem Script vs. JD2 ladbar sind
- [ ] **DOKUMENTATION_ENTWICKLUNGSSTAND.md** auf v1.0.70 aktualisieren (noch auf v1.0.50)
- [ ] **AGENTS.md** aktualisieren (Build-Regeln und Veröffentlichungsstand aktualisieren)

## 3. WICHTIGE DATEIPFADE

| Pfad | Zweck |
|------|-------|
| `F:\001_Coding_Projekte\xYTDownloader\xyt-downloader.user.js` | **Arbeitsdatei** (v1.0.70, 1972 Zeilen) |
| `F:\001_Coding_Projekte\xYTDownloader\Ausgabe\` | Versionierte Builds |
| `F:\001_Coding_Projekte\xYTDownloader\BERICHT.md` | Build-Chronik (§1–§34+) |
| `F:\001_Coding_Projekte\xYTDownloader\README.md` | Projekt-README (dreisprachig) |
| `F:\001_Coding_Projekte\xYTDownloader\description.md` | Greasy-Fork Zusatzinfos (DE → RU → EN) |
| `F:\001_Coding_Projekte\xYTDownloader\AGENTS.md` | Agent-Instruktionen |
| `F:\001_Coding_Projekte\xYTDownloader\ANALYSE_JD2_YOUTUBE.md` | JD2-Protokoll-Analyse |
| `F:\001_Coding_Projekte\xYTDownloader\memory\FACT.md` | Projekt-Fact-Sheet |

## 4. BEKANNTE BUGS & FALLSTRICKE

1. **Yandex + Rechner-Neustart = Tampermonkey kaputt:** xhr_failed/403. Fix: Tampermonkey komplett neu installieren.
2. **Playwright-Tests blockiert:** YouTube-CSP erlaubt kein addScriptTag → Tests nur mit Tampermonkey-Import möglich.
3. **`@connect` muss bestätigt werden:** Bei Script-Import erscheinen Domain-Abfragen — ALLE auf "Erlauben" klicken.
4. **v1.0.55–67 sind EXPERIMENTE:** Diese Builds enthalten falsche Download-Pfade (pageFetch, JD2-Methode, etc.). Nie als Basis verwenden.
5. **`<a download>` funktioniert NICHT cross-origin:** googlevideo.com ≠ youtube.com → kein Download via DOM-Link.

## 5. GREASY-FORK-BESCHREIBUNGSFORMAT

- **Kurzbeschreibung (@description):** DE / EN / RU in EINER Zeile (durch ` / ` getrennt)
- **Zusatzinfos (description.md):** DE → Absatz → RU → Absatz → EN (dreizeilig, KEINE Flaggen-Überschriften)
- **Sync:** description.md als raw-URL im Greasy-Fork-Admin-Tab hinterlegt

## 6. UPDATE-ABLAUF (verbindlich)

1. Version in @version + MY_VERSION heben
2. `node --check` → Syntax OK
3. `cp → Ausgabe\xyt-downloader-v<version>.user.js` + cmp + md5sum
4. BERICHT.md neuer Abschnitt (Stand, Änderung, Build-MD5)
5. `git add` + `git commit` + `git push origin main`
6. Webhook-Delivery prüfen (GitHub → Settings → Webhooks → Recent Deliveries → 200)
7. Auf https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js verifizieren

## 7. VERSIONEN-ÜBERSICHT (alle gebauten)

```
v1.0.49  — Letzter stabiler Stand (08.05.)        [md5: 3a65b6d5...]
v1.0.68  — Pur v1.0.49 Code (nur Version geändert)  [md5: e74640a2...]
v1.0.69  — v1.0.49 + 3 Features (livestream, desc)  [md5: 72e47226...]
v1.0.70  — @description /live erweitert              [md5: 16492a1b...]
v1.0.55–67 — EXPERIMENTE (pageFetch, JD2, GM_download) — NICHT VERWENDEN
```
