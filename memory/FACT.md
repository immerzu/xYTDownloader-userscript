# xYTDownloader — FACT SHEET (Stand: v1.0.70, 2026-08-09)

## Kerndaten
- **Projekt-Root:** `F:\001_Coding_Projekte\xYTDownloader\`
- **Arbeitsdatei:** `xyt-downloader.user.js` (Projektstamm, 1972 Zeilen)
- **Builds:** `Ausgabe\xyt-downloader-v<version>.user.js`
- **Git-Repo:** `immerzu/xYTDownloader-userscript` (Branch main, GitHub)
- **Greasy Fork:** Skript-ID 589972, Account `immerzu` (ID 1629833)
- **Webhook:** Push → Greasy Fork aktualisiert automatisch (Payload URL `/users/1629833-immerzu/webhook`, Content-Type json, Event push)
- **Install-Link:** https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js

## Aktueller Stand (v1.0.70)
- **Basis:** v1.0.49 Code (letzter bewiesen funktionierender Stand im Yandex-Browser)
- **3 Ergänzungen auf Basis v1.0.49:**
  1. Dreisprachige @description (DE → EN → RU in einer Zeile)
  2. Livestream-Erkennung (isLivePlayerResponse, /live/-URLs, verständliche Meldungen)
  3. Live-VOD-Meldung (keine falschen Buttons bei beendeten Livestreams ohne progressive Formate)
- **description.md** im Repo-Root: Zusatzinfos DE → RU → EN (mehrzeilig, für Greasy Fork)

## Architektur
- **Download-Client:** ANDROID_VR Innertube (POST youtubei/v1/player, clientName 28, Oculus Quest 3)
- **Progressive Downloads (360p):** itag 18 aus formats, inkl. Audiospur → Range-Chunking (4 MB) → Blob → saveBlob
- **DASH-Merge (720p+):** videoOnly + audioOnly → mergeFmp4 (bibliotheksfreies fMP4-Box-Merging)
- **Injektion:** Action-Leiste #top-level-buttons-computed (4 s Warte, dann Player-Overlay-Fallback)
- **SPA:** /(watch|shorts|live)/-Erkennung, Intervall + MutationObserver, pushState/replaceState-Override
- **@connect-Liste:** savenow.to, lbserver.xyz, dubs.io, googlevideo.com, *.googlevideo.com
- **API-Key:** Platzhalter `HIER_API_KEY_EINFUEGEN` (savenow-Fallback DEAKTIVIERT, nie reaktivieren!)

## Bekannte Limits
- Age-restricted videos, private videos, Livestreams (echt live) → Fehlermeldung
- Beendete Livestreams (isLiveContent=true) OHNE progressive Formate → Meldung "versuche später"
- Beendete Livestreams MIT progressiven Formaten → funktionieren
- Kurzlinks (youtu.be/…) sind nicht abgedeckt

## WICHTIGE Erkenntnisse aus 2026-08-08
1. **Yandex-Tampermonkey-Korruption nach Rechner-Neustart:** xhr_failed/403-Fehler waren NICHT im Script — Tampermonkey war beschädigt.
   - **Fix:** Cookies löschen → Tampermonkey komplett entfernen → Browser neu starten → Tampermonkey neu installieren → Script frisch importieren
2. **Alle Experimente (v1.0.55–v1.0.67) waren unnötig:** pageFetch, JD2-Methode, GM_download, <a download>, streamHeaders — alles zurückgerollt.
3. **v1.0.49 funktionierte durchgängig** in Playwright-Tests (360p+480p+1080p von sdk-NNVq4VY erfolgreich).

## Versionshistorie (sinnvolle Meilensteine)
- v1.0.49: Letzter stabiler Stand (2026-08-05)
- v1.0.52: Dreisprachige @description (DE → EN → RU)  
- v1.0.53/54: Livestream-Erkennung + /live/-URLs
- v1.0.56: Live-VOD-Meldung (keine 204-Buttons)
- v1.0.68: Pur v1.0.49 Code (nur Version geändert)
- v1.0.69: v1.0.49 + 3 sinnvolle Features
- v1.0.70: @description auf /live erweitert + Leerzeichen-Fix
- v1.0.55–67: **Alles Experimente — NICHT verwenden**

## Build-Regeln (bindend)
- Version in `@version` UND `MY_VERSION` heben — NIE dieselbe Version zweimal!
- `node --check` vor jedem Build
- Build per `cp → Ausgabe\`, `cmp` + `md5sum` verifizieren
- `BERICHT.md` pro Build aktualisieren
- KEINE sensiblen Daten (API-Key = Platzhalter!)
- Push → Webhook → Greasy Fork (kein manueller Upload nötig)
