# Diskrepanz-Analyse: Playwright (Agent B) vs. echte Yandex/Tampermonkey-Umgebung (Ede)

**Datum:** 2026-08-04 · **Basis:** v1.0.25 (`xyt-downloader.user.js`, Build `Ausgabe\xyt-downloader-v1.0.25.user.js`)
**Auftrag:** Nur Analyse + Diagnose-Checkliste. **Keine Code-Änderungen, kein Build.**

---

## 1. Faktenlage

### Agent B (Playwright, Chromium — Tests erfolgreich)
- Button erscheint in `#top-level-buttons-computed`, klickbar.
- Panel zeigt progressive Formate prominent + eingeklappte „Weitere Formate".
- Download (Chunking) + Fortschrittsbalken funktionieren.
- `[xYT]`-Logs erscheinen vollständig in der Konsole.

### Ede (Yandex-Browser + Tampermonkey — Tests fehlgeschlagen)
- **Kein Button sichtbar.**
- Wenn der Button da war: Panel zeigte hunderte Video-only-Formate ohne Tonspur (veralteter Stand ≤ v1.0.23).
- **Keine `[xYT]`-Logs in der Konsole (F12).**

**Schlüsselbeobachtung:** „Keine `[xYT]`-Logs" ist der wichtigste Indikator. Die Notfall-Logs in v1.0.25 (Z. 61–64) stehen **vor jeder anderen Logik** und müssen erscheinen, sobald Tampermonkey das Script überhaupt ausführt. Erscheinen sie nicht, läuft das Script **gar nicht**.

---

## 2. Vollständige Liste potenzieller Ursachen (Playwright ≠ Echtumgebung)

| # | Kategorie | Ursache | Warum in Playwright ok, bei Ede nicht? |
|---|---|---|---|
| **A** | **Metablock/Installation** | `@match`/`@grant` beim Import verloren oder beschädigt (Einfügen per Copy-Paste statt Datei-Import) | Playwright injiziert per `addScriptTag` direkt (Metablock irrelevant); Tampermonkey braucht intakten Metablock. Ohne `@match` läuft das Script nirgends; ohne `@grant GM_*` sind `GM_xmlhttpRequest`/`GM_download`/`GM_addStyle` **undefined** → Laufzeitfehler |
| **B** | **Tampermonkey-Ausführung** | Script deaktiviert, oder falscher Eintrag (alter Name/Namespace), oder „Ersetzen" beim Update abgelehnt → alte Version bleibt aktiv | Playwright kennt kein Tampermonkey; dort ist das Script immer „aktiv". Bei Ede kann eine alte Version (z. B. v1.0.16) im Editor stehen und die neue nie laufen |
| **C** | **Alte Version blockt** (v1.0.16-Mechanik) | Alte Instanz setzt `window.__xytDownloaderInstalled__ = true` (boolesches Flag) und hat einen Button gebaut → v1.0.25 sah früher „Flag + Button" → beendete sich ohne Log. **In v1.0.25 gefixt** (Notfall-Logs vor Schutz, versionierter Vergleich) | Playwright: frisches Fenster, kein Alt-Flag. Ede: Tampermonkey kann zwei Versionen parallel halten (unterschiedliche Namen) → Flag + verwaister Button |
| **D** | **Yandex-spezifisch** | Yandex Browser blockt Userscripts auf bestimmten Seiten (z. B. „Turbo"-Modus, Datenschutz-Funktionen) oder GM_*-APIs anders | Playwright nutzt Chromium-Engine ohne Yandex-Extras; Yandex kann Erweiterungs-Injektion auf YouTube anders behandeln |
| **E** | **CSP der YouTube-Seite** | `require-trusted-types-for 'script'` + `script-src 'strict-dynamic'` | Das Script nutzt seit v1.0.2 kein `innerHTML` mehr (`replaceChildren`) — CSP ist **nicht** die Ursache; frühere Versionen (≤ v1.0.1) scheiterten daran. Playwright-Shim umging es teils |
| **F** | **Injektionszeitpunkt** | `@run-at document-idle` + 4-s-Wartezeit (`BAR_WAIT_MS`) | In Playwright wird via `addScriptTag` sofort injiziert und lange gewartet; bei Ede kann die Action-Leiste langsamer/anders erscheinen → Button-Fallback (Player-Overlay) sollte aber greifen. Nicht Hauptursache für „keine Logs" |
| **G** | **Konkurrierende Userscripts/Erweiterungen** | Andere Scripts (z. B. „Youtube Tools All in one", „Simple-YouTube-Age-Restriction-Bypass", „Youtube Genius Lyrics") können DOM umbauen, `ytcfg` verändern oder Fehler werfen, die unser Script brechen | In Playwright liefen ebenfalls diese Scripts (im Log sichtbar), aber sie können in Yandex anders interagieren |
| **H** | **YouTube A/B-Tests / DOM-Variation** | `#top-level-buttons-computed` kann bei eingeloggtem Konto/anderem Layout anders benannt oder in Shadow-DOM versteckt sein | Playwright: meist ausgeloggt/Standard-Layout; Ede: eingeloggt mit Yandex — andere DOM-Variante möglich. (Aber: Fallback `#movie_player` existiert immer → Button müsste trotzdem erscheinen) |
| **I** | **JS-Fehler vor Button-Injektion** | Syntax-/Laufzeitfehler (z. B. fehlende GM_-Funktion, `?.`-Syntax in altem Yandex) beendet das Script vor `refresh()` | Playwright-Chromium aktuell; Yandex kann ältere JS-Engine haben. `node --check` fand keinen Syntaxfehler — aber fehlende `@grant` (siehe A) erzeugt `ReferenceError: GM_addStyle is not defined` |
| **J** | **Caching** | Tampermonkey-Editor zeigt alte Version; Browser-Cache liefert alte `user.js`-Datei | Playwright lädt die Datei frisch von Disk; Ede importiert evtl. eine veraltete Kopie |

---

## 3. DIAGNOSE-CHECKLISTE für Ede (weiterleitbar an Agent A)

> **Ziel:** In ≤ 5 Minuten feststellen, ob das Script läuft und wo es scheitert. Alle Schritte in **Yandex-Browser**, Tab mit `https://www.youtube.com/watch?v=…`.

### Schritt 0 — Saubere Installation (Voraussetzung)
1. Tampermonkey-Dashboard öffnen → **ALLE Einträge mit Namen „xYT-Downloader" löschen** (auch alte Versionen!).
2. **Datei importieren** (Dashboard → Utilities → Datei importieren → `xyt-downloader-v1.0.25.user.js`) — **NICHT** per Copy-Paste in „Neues Skript".
3. Sicherstellen, dass der Eintrag **aktiviert** (grüner Schalter) ist.
4. YouTube-Watch-Seite mit **F5 neu laden** (nicht nur SPA-Wechsel).

### Schritt 1 — Läuft das Script überhaupt? (F12 → Konsole)
Die Konsole (F12 → „Konsole"/„Console") muss **sofort nach dem Laden** diese drei Zeilen zeigen:
```
[xYT] Script geladen v1.0.25
[xYT] URL: https://www.youtube.com/watch?v=…
[xYT] Instanz-Flag: undefined
```
- **Alle 3 Zeilen da?** → Script läuft. → Weiter zu Schritt 2.
- **Keine `[xYT]`-Zeile?** → Tampermonkey führt das Script **nicht aus**. Ursachen: Metablock kaputt (Schritt 0), falsche Domain (URL muss `/watch` enthalten), Script deaktiviert, Yandex blockt Erweiterung. → Prüfe in Tampermonkey: Eintrag existiert, aktiv, `@match *://www.youtube.com/watch*` vorhanden. Falls ja und trotzdem nichts: Yandex-Erweiterungsseite (`browser://extensions`) prüfen, ob Tampermonkey auf youtube.com erlaubt ist.
- **`Instanz-Flag: '1.0.25'` oder ein alter Wert (`true`/`1.0.16`)?** → Es läuft noch eine zweite/ältere Instanz. → Schritt 0 wiederholen (alle xYT-Einträge löschen).

### Schritt 2 — Ist der Button im DOM? (Konsole eingeben)
```
document.querySelector('#xyt-dl-btn')
```
- **Ergebnis = `<button …>`** → Button existiert. Falls er nicht sichtbar ist, aber im DOM: Prüfen, wo er hängt:
  ```
  document.querySelector('#xyt-dl-btn').parentElement
  ```
  → Sollte `#top-level-buttons-computed` sein. Falls `#movie_player` → YouTube-Leiste nicht geladen (Wartezeit abgelaufen); Seite neu laden.
- **Ergebnis = `null`** → Button wurde nicht injiziert. → Konsole auf **rote Fehlermeldungen** prüfen (siehe Schritt 3). Zusätzlich prüfen, ob die YouTube-Leiste existiert:
  ```
  !!document.querySelector('#top-level-buttons-computed')
  ```
  - `false` → YouTube hat ein anderes Layout (A/B-Test) → das Script fällt auf den Player-Overlay-Fallback zurück; nach **4 s** sollte der Button oben rechts im Video erscheinen.

### Schritt 3 — Gibt es JS-Fehler? (Konsole → Filter „Fehler"/„Errors")
- Nach `[xYT] Script geladen` muss nichts weiter erscheinen, aber **keine rote Exception** mit `xyt-downloader` im Stack.
- Typische Fehler und ihre Bedeutung:
  - `GM_addStyle is not defined` / `GM_xmlhttpRequest is not defined` → **@grant fehlt** (Metablock beschädigt) → Neu-Import (Schritt 0).
  - `TypeError: … is not a function` → alte Version aktiv oder Yandex-Block.
  - **Keine Fehler, aber auch kein Button** → ungewöhnlich; dann Schritt 4.

### Schritt 4 — Panel und Formate prüfen (nach Button-Klick)
1. Button klicken → Panel erscheint?
2. Konsole zeigt die Format-Logs:
   ```
   [xYT] Format(itag=18) aus formats-Array: … hasAudio=true   ← progressiv MIT Ton
   [xYT] Format(itag=299) aus adaptiveFormats: … hasAudio=false ← Video-only
   ```
3. Sichtbar im Panel: **oben progressive Formate** (360p/720p ohne „(ohne Ton)"), darunter eingeklappt „Weitere Formate (N)".

---

## 4. Konkrete Fehlerursache (falls ohne Edes Rückmeldung benennbar)

**Wahrscheinlichste Ursache (basierend auf „keine Logs" + „hunderte Video-only-Formate"):**

> **Es läuft bei Ede eine ALTE Version des Scripts (≤ v1.0.23), nicht v1.0.25.** Die alten Versionen (a) zeigten alle DASH-Formate ohne Trennung („hunderte Video-only"), (b) hatten ihr init-Log NACH dem aggressiven Instanz-Schutz — daher keine `[xYT]`-Logs, wenn eine zweite Instanz das Flag setzte, und (c) wurden durch den v1.0.16-Flag-Mechanismus geblockt. In Playwright wurde immer die **aktuelle Datei** frisch von Disk geladen — dort konnte keine Altversion dazwischenfunken.

**Warum das zu „kein Button + keine Logs" passt:** Wenn Tampermonkey noch einen alten Eintrag (z. B. v1.0.16) aktiv hat UND der Nutzer v1.0.25 zusätzlich importiert, läuft die alte zuerst (setzt boolesches Flag + baut evtl. Button). Die neue v1.0.25 sieht in **älteren Versionen** das Flag → beendet sich. In **v1.0.25 selbst** ist das gefixt (Notfall-Logs vor Schutz, Version verglichen) — aber nur, wenn v1.0.25 wirklich der aktive Eintrag ist.

**Vorgeschlagener Fix (nach Bestätigung durch Checkliste):**
1. **Alle** xYT-Downloader-Einträge in Tampermonkey löschen (nicht nur den sichtbaren).
2. v1.0.25 per **Datei-Import** installieren (nie Copy-Paste).
3. Seite hart neu laden (F5) und Schritt-1-Logs prüfen.
4. Falls danach immer noch keine Logs: Tampermonkey in Yandex auf `browser://extensions` prüfen (aktiviert + Zugriff auf youtube.com erlaubt) — Yandex kann Erweiterungen pro Seite blocken.

---

## 5. Benötigte Rückmeldung von Ede (falls Checkliste nicht abschließend)

Falls nach den Schritten 0–4 weiterhin unklar ist, braucht Agent B von Ede:
1. **Antwort auf Schritt 1:** Erscheinen die 3 `[xYT]`-Zeilen? (Ja/Nein + exakter Text)
2. **Tampermonkey-Screenshot der Script-Liste** (welche Versionen von xYT-Downloader vorhanden, welcher aktiviert).
3. **Yandex-Version + Tampermonkey-Version** (Dashboard → Hilfe → Über).
4. **Screenshot der Konsole** mit gefilterten Fehlern (falls vorhanden).
5. **URL + eingeloggt/ausgeloggt** (YouTube-Konto-Zustand).
6. Falls Button da: Ergebnis von `document.querySelector('#xyt-dl-btn').parentElement`.

Diese Informationen fließen zurück an Agent B (über Agent A), der damit die Ursache eindeutig eingrenzt.
