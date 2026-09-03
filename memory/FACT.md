# xYTDownloader — FACT SHEET (Stand: v1.0.80, 2026-09-01)

## Kerndaten
- **Projekt-Root:** `F:\001_Coding_Projekte\xYTDownloader\`
- **Arbeitsdatei:** `xyt-downloader.user.js` (Projektstamm, 2151 Zeilen)
- **Builds:** `Ausgabe\xyt-downloader-v<version>.user.js`
- **Git-Repo:** `immerzu/xYTDownloader-userscript` (Branch main, GitHub)
- **Greasy Fork:** Skript-ID 589972, Account `immerzu` (ID 1629833)
- **Webhook:** Push → Greasy Fork aktualisiert automatisch (Payload URL `/users/1629833-immerzu/webhook`, Content-Type json, Event push). **VERIFIZIERT FUNKTIONIEREND (2026-08-28):** v1.0.76 (27.08. 16:17 MESZ) kam per Webhook (Delivery 14:17:07Z, +19 s nach Commit `cc7ebb9`) — GF-Versions-Zeitstempel = Delivery-Zeit. Der GF-Admin zeigt „Letzte erfolgreiche Synchronisierung: 09.08.2026" — das ist das Webhook-Sync-Feld, nicht die Übernahme-Zeit. **Der Webhook-Pfad validiert NICHT** (übernimmt Roh-Code mit 674-Zeichen-@description unbemerkt), der manuelle Upload validiert (500-Zeichen-Limit + @description:de-Pflicht). **Manueller Upload bleibt für die Validierung der bevorzugte Weg**, aber der Webhook ist nicht defekt.
- **Install-Link:** https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js

## Aktueller Stand (v1.0.80)
- **v1.0.80 (2026-09-01):** Fix "LOGIN_REQUIRED — Sign in to confirm you're not a bot" — `fetchAndroidVrPlayer` (Player-Request) nutzt jetzt Seiten-`fetch` statt `GM_xmlhttpRequest` (Seiten-Kontext trägt die Browser-Session, umgeht YouTubes Bot-Prüfung; verifiziert: status OK, 27 adaptiveFormats). GF live + GitHub Release v1.0.80.
- **Download-Client:** VISIONOS statt ANDROID_VR (Name 1.02, `RealityDevice17,1`) — ANDROID_VR lieferte wieder 403/UNPLAYABLE ohne POT-Token (`fetchAndroidVrPlayer()` Z. 1000)
- **Download-Fetches:** `&range=` URL-Parameter statt Range-Header + googlevideo-Referer (Range-Header → 403), init-Segment (ftyp+moov) separat laden
- **Container:** MP4-Präferenz in `codecRank()` (video/mp4 vor webm) — WebM/VP9 itag 313/271 ist EBML und nicht mit `mergeFmp4` muxbar
- **Metablock (GF-Validierung, WICHTIG):**
  - `@description`: **max. 500 Zeichen** — aktuelle Kurzfassung 402 Zeichen (DE/EN/RU einzeilig)
  - `@description:de`: **Pflicht für deutsche by-site-Zuordnung** (226 Zeichen) — sonst erscheint das Skript NICHT auf `greasyfork.org/de/scripts/by-site/youtube.com`
  - `@name:de`: ebenfalls ergänzt (v1.0.77)
- **description.md** im Repo-Root: Zusatzinfos DE → RU → EN (mehrzeilig, für Greasy Fork)

## Architektur
- **Download-Client:** VISIONOS Innertube (POST youtubei/v1/player, clientName 1.02, RealityDevice17,1)
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

## WICHTIGE Erkenntnisse
0. **⚠️ ERSTER CHECK BEI `LOGIN_REQUIRED / "Sign in to confirm you're not a bot"`: VPN AUSSCHALTEN!** (2026-09-03, entscheidende Ursache)
   - **Symptom:** Beim YouTube-Download erscheint `Formate konnten nicht geladen werden: YouTube-Status: LOGIN_REQUIRED – Sign in to confirm you're not a bot`. Fehler tritt **überall** auf (xYT-Skript egal welche Version, JDownloader2, sogar normales YouTube-Seiten-HTML liefert `playabilityStatus:LOGIN_REQUIRED, logged_in:0`). JD2 meldet es selbst als `ERROR_TEMPORARILY_UNAVAILABLE`.
   - **Root Cause:** Ein aktiver **VPN** — YouTube stuft die VPN-IP als Bot ein und sperrt die Downloads. NICHT ein Code-/Versions-/Login-Bug.
   - **Proof:** Fast ein ganzer Tag vergeudeter Code-Experimente (v1.0.85–88: Web-Player-Stream-Umbau, wholeFile-Flag, 403-Fixes usw.) — alles UNNÖTIG. Als der Nutzer den VPN ausschaltete, funktionierte der Download sofort normal (v1.0.81-Code genügt).
   - **Fix:** VPN ausschalten (bzw. andere IP/Netz), dann funktionieren xYT UND JDownloader2 normal. Bei VPN an ist youtube über die gesperrten Nicht-WEB-Clients (Android/VISIONOS) + JD2 gleichermaßen blockiert.
   - **Erkenntnis für die Zukunft:** Bevor irgendein LOGIN_REQUIRED/403/`not a bot`-Fehler im xYT-Code gesucht wird → zuerst beim Nutzer nachfragen, ob ein **VPN/Tor/Proxy** aktiv ist. Code-Experimente nur starten, wenn KEIN VPN aktiv ist.
1. **GF-Validierung (2026-08-28):** Upload schlägt fehl, wenn `@description` > 500 Zeichen (674 war zu lang) ODER `@description:de` fehlt → genau deshalb fehlte das Skript auf der deutschen by-site-Seite (nicht Cache, nicht Sandbox).
1b. **WARNUNG zu den Versions-Experimenten von 2026-09-03 (durch VPN-Fehler ausgelöst, unnötig):** Der Web-Player-Umbau (`getPlayerApiResponse`, `wholeFile`, 403-Fast-Path) war **durch den VPN-Fehler ausgelöst und unnötig**. WICHTIG daher: **v1.0.88** (2026-09-03 installiert & im Yandex VERIFIZIERT FUNKTIONIEREND sobald VPN aus) ist im Kern nur der einfache **v1.0.81-VISIONOS-Code** mit hochgezogener Versionsnummer — NICHT der komplexe Web-Player-Umbau. Damit ist die gewünschte "zurück auf funktionierende Version" = **v1.0.81-Code (FACT/Core VISIONOS)** identisch mit v1.0.88. Falls komplexe Umbau-Versionen (getPlayerApiResponse/wholeFile, d. h. die frühe v1.0.85–v1.0.87) veröffentlicht wurden, auf einfachen VISIONOS-Stand zurückrollen.
2. **Yandex-Tampermonkey-Korruption nach Rechner-Neustart (2026-08-08):** xhr_failed/403-Fehler waren NICHT im Script — Tampermonkey war beschädigt.
   - **Fix:** Cookies löschen → Tampermonkey komplett entfernen → Browser neu starten → Tampermonkey neu installieren → Script frisch importieren
3. **Alle Experimente (v1.0.55–v1.0.67) waren unnötig:** pageFetch, JD2-Methode, GM_download, <a download>, streamHeaders — alles zurückgerollt.

## Versionshistorie (sinnvolle Meilensteine)
- v1.0.49: Letzter stabiler Stand (2026-08-05)
- v1.0.52: Dreisprachige @description (DE → EN → RU)
- v1.0.53/54: Livestream-Erkennung + /live/-URLs
- v1.0.56: Live-VOD-Meldung (keine 204-Buttons)
- v1.0.68: Pur v1.0.49 Code (nur Version geändert)
- v1.0.69: v1.0.49 + 3 sinnvolle Features
- v1.0.70: @description auf /live erweitert + Leerzeichen-Fix
- v1.0.71–76: VISIONOS-Client + &range= + init-Segment + MP4-Präferenz (Fix für Download-Bruch ALLER Auflösungen)
- v1.0.77: @name:de hinzugefügt (deutsche by-site-Zuordnung)
- v1.0.78: @description auf <500 Zeichen gekürzt + @description:de ergänzt (GF-Validierung bestanden)
- v1.0.79: Alle JD2/JDownloader2-Verweise aus Script-Kommentaren entfernt (neutrale Formulierungen)
- v1.0.80: Fix LOGIN_REQUIRED — Player-Request per Seiten-fetch statt GM_xmlhttpRequest
- v1.0.55–67: **Alles Experimente — NICHT verwenden**

## Build-Regeln (bindend)
- Version in `@version` UND `MY_VERSION` heben — NIE dieselbe Version zweimal!
- Metablock-GF-Validierung: `@description` **max. 500 Zeichen** (aktuell 402), **`@description:de` Pflicht** (aktuell 226) + **`@name:de`** — sonst scheitert der GF-Upload und das Skript fehlt auf der deutschen by-site-Seite.
- `node --check` vor jedem Build
- Build per `cp → Ausgabe\`, `cmp` + `md5sum` verifizieren (MD5 im BERICHT.md EINTRAGEN — reale Werte! vgl. §45/46; nie den Wert der Vorversion kopieren)
- `BERICHT.md` pro Build aktualisieren
- KEINE sensiblen Daten (API-Key = Platzhalter!)
- Push → Webhook → Greasy Fork (kein manueller Upload nötig) — **Webhook verifiziert funktionierend (v1.0.76 kam per Webhook); ABER: Webhook-Pfad validiert nicht (übernimmt auch 674-Zeichen-@description ohne @description:de) — manueller Upload validiert (500-Zeichen + @description:de). Für saubere GF-Validierung: manueller Upload bevorzugen.**
- GitHub-Release pro Version: Git-Tag `v<version>` + `gh release create` mit `Ausgabe/xyt-downloader-v<version>.user.js` als Asset (seit v1.0.76). Achtung: Tag per `gh release create` existiert remote, kann lokal fehlen (v1.0.77) — `git fetch --tags` synchronisiert.
