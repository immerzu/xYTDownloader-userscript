# xYTDownloader — FACT SHEET (Stand: v1.0.91, 2026-09-19)

## Kerndaten
- **Projekt-Root:** `F:\001_Coding_Projekte\xYTDownloader\`
- **Arbeitsdatei:** `xyt-downloader.user.js` (Projektstamm, 1895 Zeilen)
- **Builds:** `Ausgabe\xyt-downloader-v<version>.user.js`
- **Git-Repo:** `immerzu/xYTDownloader-userscript` (Branch main, GitHub)
- **Greasy Fork:** Skript-ID 589972, Account `immerzu` (ID 1629833)
- **Webhook/Sync:** Push → Greasy Fork aktualisiert automatisch (Sync-Quelle `https://raw.githubusercontent.com/immerzu/xYTDownloader-userscript/main/xyt-downloader.user.js`; Payload `/users/1629833-immerzu/webhook`, Event push). **Verifiziert:** v1.0.76 (+19 s), v1.0.89 (14:32:59Z), **v1.0.91 (2026-09-19T07:42:48Z, ~20 s nach Push `bc997e3`)**. **Aber nicht blind warten — messen** (`Invoke-RestMethod https://greasyfork.org/scripts/589972.json` → `version`, `code_updated_at`); bei Verzug Admin-Trigger (`gf-admin-sync.mjs`; belegt 2026-09-14: ~4 min Verzug). Sync übernimmt Roh-Code (validiert nicht); harte Grenze bleibt `@description` ≤ 500 Zeichen.
- **Install-Link:** https://update.greasyfork.org/scripts/589972/xYTDownloader.user.js

## Aktueller Stand (v1.0.91)
- **v1.0.80 (2026-09-01):** Fix "LOGIN_REQUIRED — Sign in to confirm you're not a bot" — `fetchAndroidVrPlayer` (Player-Request) nutzt jetzt Seiten-`fetch` statt `GM_xmlhttpRequest` (Seiten-Kontext trägt die Browser-Session, umgeht YouTubes Bot-Prüfung; verifiziert: status OK, 27 adaptiveFormats). GF live + GitHub Release v1.0.80.
- **v1.0.88 (2026-09-03):** Aufräumarbeit/Rollback auf den einfachen VISIONOS-Stand (v1.0.81-Basis) — die unnötigen Web-Player-Umbau-Experimente v1.0.85–87 (`getPlayerApiResponse`/`wholeFile`) wurden verworfen (Auslöser war ein aktiver VPN, nicht der Code; vgl. Erkenntnisse 0/1b).
- **v1.0.89 (2026-09-05):** `@description:de` + `@name:de` entfernt — GF-Kurzbeschreibung zeigt einheitlich DE/EN/RU statt nur DE (GF live v1.0.89, Webhook-Übernahme 14:32:59Z). Danach nachgezogen: `MY_VERSION`-Abgleich 1.0.88 → 1.0.89, erster v1.0.89-Build + Release-Asset (BERICHT §54/§55).
- **v1.0.90 (2026-09-06):** Kurzbeschreibung **lokalisiert** — `@description` (EN-Default, = GF-Skript-Locale) + `@description:de` + `@description:ru`. Grund: GF-Suchfilter macht ein Skript ohne Suffix-Lokalisierungen nur in seiner Skript-Locale auffindbar (xYT war nur in der EN-Suche sichtbar). Ziel: Auffindbarkeit in DE/EN/RU-Suchen (BERICHT §56, Erkenntnis 1d).
- **v1.0.91 (2026-09-19, GF live + GitHub-Release, im Firefox verifiziert):** **Firefox-Fix** „leere Chunk-Antwort (Status 0)" beim DASH-Merge — `fetchRangeChunk` setzt keine Custom-Header mehr (Ursache: `User-Agent`-Header → CORS-Preflight in Firefox, s. Erkenntnis 1e); zusätzlich wird die fetch-Fehlerursache geloggt und an die Panel-Meldung angehängt (BERICHT §57).
- **Download-Client:** VISIONOS statt ANDROID_VR (Name 1.02, `RealityDevice17,1`) — ANDROID_VR lieferte 403/UNPLAYABLE ohne POT-Token (`fetchAndroidVrPlayer()`, Z. 849; **kein Timeout** — s. Offene Punkte)
- **Download-Fetches:** `&range=`-URL-Parameter statt Range-Header, init-Segment (ftyp+moov) separat laden. **Seit v1.0.91 ohne Custom-Header** (Referer/UA/Accept-Encoding entfernt — der UA-Header löste in Firefox einen CORS-Preflight aus, Erkenntnis 1e)
- **Container:** MP4-Präferenz in `codecRank()` (video/mp4 vor webm) — WebM/VP9 itag 313/271 ist EBML und nicht mit `mergeFmp4` muxbar
- **Metablock (GF-Validierung, WICHTIG):**
  - `@description`: **max. 500 Zeichen** — aktuell (EN) 146 Zeichen — die dokumentierte Upload-Hartgrenze
  - **Seit v1.0.90 LOKALISIERT:** `@description` = englische Kurzbeschreibung (Default, entspricht GF-Skript-Locale `en`) + `@description:de` + `@description:ru` (je eigene Zeile). Damit ist das Skript in der GF-Suche unter EN/DE/RU auffindbar (GF-Sprachfilter `filter_locale`; Details BERICHT §56, Erkenntnis 1d). KEIN `@description:en` (würde bei Skript-Locale `en` ignoriert), keine `@name:xx`-Zeilen ohne passendes `@description:xx` (GF-Validierung), keine kombinierten Mischtext-Zeilen. Vor v1.0.90: einheitliche DE/EN/RU-Zeile ohne Suffixe (v1.0.89) → nur in EINER Sprache auffindbar.
- **description.md** im Repo-Root: Zusatzinfos DE → RU → EN (mehrzeilig, für Greasy Fork)

## Architektur
- **Download-Client:** VISIONOS Innertube (POST youtubei/v1/player, clientName 1.02, RealityDevice17,1)
- **Progressive Downloads (360p):** itag 18 aus formats, inkl. Audiospur → Range-Chunking (4 MB) → Blob → saveBlob
- **DASH-Merge (720p+):** videoOnly + audioOnly → mergeFmp4 (bibliotheksfreies fMP4-Box-Merging)
- **Injektion:** Action-Leiste #top-level-buttons-computed (4 s Warte, dann Player-Overlay-Fallback)
- **SPA:** /(watch|shorts|live)/-Erkennung, Intervall + MutationObserver, pushState/replaceState-Override
- **@connect-Liste:** nur `googlevideo.com`, `*.googlevideo.com` (savenow/lbserver/dubs seit v1.0.82 entfernt)
- **Kein API-Key, kein Fremd-Dienst:** savenow/dubs-Fallback ist seit v1.0.82 komplett entfernt — nie wieder einbauen; es gibt keine Secrets im Skript

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
1. **GF-Validierung (2026-08-28, historisch — durch 1c/1d überholt):** Der Upload scheiterte bei `@description` > 500 Zeichen (674 war zu lang); das Fehlen von `@description:de` ließ das Skript damals auf der deutschen by-site-Seite fehlen. **Aktuell gilt:** jede `@description`-Zeile ≤ 500 Zeichen + lokalisierte Zeilen (`:de`, `:ru`) für die Auffindbarkeit (Erkenntnis 1d).
1b. **WARNUNG zu den Versions-Experimenten von 2026-09-03 (durch VPN-Fehler ausgelöst, unnötig):** Der Web-Player-Umbau (`getPlayerApiResponse`, `wholeFile`, 403-Fast-Path) war **durch den VPN-Fehler ausgelöst und unnötig**. WICHTIG daher: **v1.0.88** (2026-09-03 installiert & im Yandex VERIFIZIERT FUNKTIONIEREND sobald VPN aus) ist im Kern nur der einfache **v1.0.81-VISIONOS-Code** mit hochgezogener Versionsnummer — NICHT der komplexe Web-Player-Umbau. Damit ist die gewünschte "zurück auf funktionierende Version" = **v1.0.81-Code (FACT/Core VISIONOS)** identisch mit v1.0.88. Falls komplexe Umbau-Versionen (getPlayerApiResponse/wholeFile, d. h. die frühe v1.0.85–v1.0.87) veröffentlicht wurden, auf einfachen VISIONOS-Stand zurückrollen.
1c. **Korrektur Locale-Zeilen (2026-09-05):** Erkenntnis 1 („@description:de Pflicht") gilt NICHT mehr normativ: `@description:de`/`@name:de` wurden in v1.0.89 **bewusst entfernt** (mit Locale-Zeilen zeigte GF überall nur die DE-Kurzbeschreibung; gewünscht ist die einheitliche DE/EN/RU-Zeile). v1.0.89 ist live OHNE beide Locale-Zeilen (GF-API bestätigt `version: 1.0.89`). Harte GF-Upload-Grenze bleibt `@description` ≤ 500 Zeichen. Ob der manuelle Upload auch ohne `@description:de` akzeptiert, ist nicht separat getestet (v1.0.77 scheiterte bei 674 Zeichen @description).
1d. **GF-Sprachfilter — Lokalisierung nötig (2026-09-06, Quellcode-belegt):** Die GF-Suche filtert standardmäßig nach Sprache („Es werden nur Ergebnisse in … angezeigt", `filter_locale`). Jedes Skript hat genau EINE feste Skript-Locale (`script.locale`, beim Erst-Upload per detectlanguage.com gesetzt, danach fix). Nur die `@description` OHNE Suffix wird als Default in genau dieser Skript-Locale gespeichert → eine kombinierte „DE/EN/RU"-Zeile macht das Skript nur in EINER Sprache auffindbar (Live-Test: xVKDownloader nur auf /de/, xYTDownloader nur auf /en/, beide nicht auf /ru/). **Lösung (ab v1.0.90):** `@description` in der Skript-Locale (xYT = EN) + `@description:de` + `@description:ru` → GF speichert je Sprache eine Lokalisierung → Skript erscheint in DE/EN/RU-Suchen. Belege: greasyfork-org/greasyfork `script.rb:175-186` (set_locale nur bei `locale.nil?`), `script.rb:800-844` (update_localized_attribute; Skip bei Suffix == Skript-Locale), `script_indexing.rb:131` (Suchfeld `locale` = alle Lokalisierungen), `script_listings.rb:312-336` (Filter `with[:locale]`). Gilt für ALLE immerzu-GF-Skripte (xVK v1.0.15, xLoader analog).
1e. **Firefox-CORS-Falle: `User-Agent`-Header in `fetch` (2026-09-19, behoben in v1.0.91):** Unser Chunk-Fetch setzte `Referer`, `User-Agent` (Desktop-UA) und `Accept-Encoding: identity`. **In Firefox ist `User-Agent` seit FF43 NICHT mehr forbidden** → er wird wirklich gesendet → als Nicht-Safelisted Header erzwingt er einen **CORS-Preflight**, den googlevideo ablehnt (`Access-Control-Allow-Headers` enthält `Range`, aber kein `User-Agent`) → `fetch` wirft TypeError → Panel: **„leere Chunk-Antwort (Status 0)"**. **Chromium verwirft den UA-Header still ([crbug 571722](https://crbug.com/571722))** → in Yandex/Chrome fiel es nie auf; `Referer`/`Accept-Encoding` sind forbidden und kamen nie an. Fix: keine Custom-Header im Chunk-Fetch. **Merksatz: Status 0 (fetch-Abbruch) + Firefox ⇒ zuerst CORS/Preflight bzw. Erweiterungen (uBlock/AdGuard) prüfen — NICHT VPN/POT (das ergibt 403).** Diagnose-Tools: `C:\Users\lolo\.dsh\browser-tools\yt-cors-probe.mjs` (misst OPTIONS-Preflight-Antworten), `yt-stream-probe.mjs` (holt echte googlevideo-URL), `ff-preflight-probe.mjs` (echter Firefox-Test; benötigt geckodriver).
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
- v1.0.81: VISIONOS in allen öffentlichen Beschreibungen (ANDROID_VR → VISIONOS)
- v1.0.82: toter savenow/dubs-Fallback entfernt (Downloads komplett Seiten-fetch)
- v1.0.83/84: LOGIN_REQUIRED-Fixes für Yandex (credentials:'include', dann SAPISID-Authorization-Header)
- v1.0.85–87: Web-Player-Umbau (getPlayerApiResponse/wholeFile) — unnötige VPN-Experimente, verworfen
- v1.0.88: Rollback auf einfachen VISIONOS-Stand (v1.0.81-Basis) + Aufräumarbeit
- v1.0.89: @description:de/@name:de entfernt (einheitliche GF-Kurzbeschreibung) + MY_VERSION-Abgleich
- v1.0.90: Kurzbeschreibung lokalisiert (@description EN + :de + :ru) — GF-Suchbarkeit in DE/EN/RU
- v1.0.91: Firefox-Fix — keine Custom-Header im Chunk-Fetch (UA-Header löste CORS-Preflight aus → Status 0)
- v1.0.55–67: **Alles Experimente — NICHT verwenden**

## Build-Regeln (bindend)
- Version in `@version` UND `MY_VERSION` heben — NIE dieselbe Version zweimal!
- Metablock-GF-Validierung: `@description` **max. 500 Zeichen**; **lokalisierte Beschreibung** = Default-`@description` in der GF-Skript-Locale (xYT: `en`) + `@description:de` + `@description:ru`. Keine `@name:xx`-Zeilen ohne passendes `@description:xx`.
- `node --check` vor jedem Build
- Build per `cp → Ausgabe\`, `cmp` + `md5sum` verifizieren (MD5 im BERICHT.md EINTRAGEN — reale Werte! vgl. §45/46; nie den Wert der Vorversion kopieren)
- `BERICHT.md` pro Build aktualisieren
- KEINE sensiblen Daten/Secrets (Secret-Prüfung vor jedem Upload: `git grep` + Historie; Skill `greasy-fork-publish`)
- **Veröffentlichen = Ablauf C:** Commit + Push auf `main` → GF-Sync; danach **messen** (`https://greasyfork.org/scripts/589972.json` → `version`/`code_updated_at`) + GF-Display-Check DE/EN/RU; bei Verzug Admin-Trigger (`gf-admin-sync.mjs`). Manueller Upload (`gf-publish.mjs version`) nur als Fallback; der Sync-Pfad validiert nicht (hart: `@description` ≤ 500).
- GitHub-Release pro Version: Git-Tag `v<version>` + `gh release create` mit `Ausgabe/xyt-downloader-v<version>.user.js` als Asset (seit v1.0.76). Achtung: Tag per `gh release create` existiert remote, kann lokal fehlen (v1.0.77) — `git fetch --tags` synchronisiert.

## Umgebung & Werkzeuge (Stand 2026-09-19)
- **Nutzer-Browser:** Yandex (Tampermonkey) **und** portabler **Firefox 155.0.1** (`D:\Programme\PortableApps\FirefoxPortable\App\Firefox64\firefox.exe`, Profil `…\FirefoxPortable\Data\profile`; Add-ons: Tampermonkey `firefox@tampermonkey.net`, uBlock Origin, AdGuard).
- **Firefox ist NICHT automatisierbar:** `playwright-core` steuert nur den gepatchten playwright-Firefox-Build (nicht den normalen Firefox); der geckodriver-Download ist in dieser Umgebung blockiert (GitHub-Release-URLs nicht erreichbar). → **Firefox-Tests macht der Nutzer** (Fix ausliefern, Nutzer bestätigt). Chromium-Tests laufen über das `reasonix-profil`.
- **Installierte Skriptversion im Firefox prüfen (ohne UI):** Die Skriptdatei liegt im Tampermonkey-IndexedDB-Speicher und ist byte-gleich zur Ausgabe-Datei — `…\Data\profile\storage\default\moz-extension+++<UUID>^userContextId=4294967295\idb\*\files\<n>`; Größenvergleich mit `Ausgabe\xyt-downloader-v<version>.user.js` (am 2026-09-19: 92.102 Bytes = v1.0.90; UUID `69d10498-abfd-4b93-9488-3cba9eaa39e7`).
- **GitHub:** `gh` + API funktionieren; **direkte Downloads von github.com-Release-Assets sind blockiert** (daran scheiterten geckodriver-Installationen).
- **GF-Verifikation ohne Browser:** `https://api.greasyfork.org/scripts/589972.json` (ein `web_fetch` auf `greasyfork.org/…json` scheitert an der Umleitung zu `api.greasyfork.org` → Adresse direkt angeben) → `version`, `code_updated_at`, `locale`, `description`; Sprachsuche `/de|en|ru/scripts?q=xytdownloader`.
- **GF-Diskussionsantworten:** `C:\Users\lolo\.dsh\browser-tools\gf-reply.mjs` — `diag --url <thread>` (read-only Struktur) · `reply --url <thread> --file <text> [--dry-run]`. **Login-Erkennung NICHT über den Header-Text:** die `/de/`-Diskussionsseite zeigt „Anmelden" auch im eingeloggten Zustand (Text-Check liefert falsches `LOGIN_REQUIRED`); verlässlich ist die vorhandene Antwort-Textarea `textarea[name="comment[text]"]` (Formular-Action `…/comments#post-reply`, Markdown-Radio `comment[text_markup]`, Submit „Antworten"). Erste Bewährungsprobe: zwei russische Antworten am 2026-09-06/07 erfolgreich gepostet (Kommentare #666182, #666235).
- **Diagnose-Tools (browser-tools):** `yt-stream-probe.mjs` (holt echte googlevideo-URL), `yt-cors-probe.mjs` (misst OPTIONS-Preflight-Antworten), `ff-preflight-probe.mjs` (echter Firefox-Test — braucht geckodriver, derzeit blockiert).

## Offene Punkte / Nutzer-Feedback (Stand 2026-09-19)
1. **GF-Diskussion 339057** (Nutzer „Spok", 06./07.09.2026, russisch): Mobil (Android 5.1 + Via) schwarzer Player → Ursache ist die Umgebung (YouTube/WebView kann dort nicht abspielen; das Skript greift nicht in die Wiedergabe ein). Desktop „Download startet nicht" → **seit v1.0.91 ist die Firefox-CORS-Ursache (Erkenntnis 1e) die wahrscheinlichste Erklärung**. Zwei russische Antworten gepostet; offen: Spoks Angaben (Installationsweg in Via, Panel-Verhalten, `[xYT]`-Logs) und ggf. eine Via-kompatible Anpassung.
2. **GM-lose Umgebungen (Via-eigene Skript-Engine?):** `downloadUrl` hat ein obsoletes `typeof GM_xmlhttpRequest`-Gate (Z. 354) → ohne GM-APIs landen progressive Downloads still in `fallbackDownload` (GM_download/`window.open`) statt in den nativen fetch-Chunks. Kandidat für einen Via-kompatiblen Fix (Gate entfernen).
3. **Kein Timeout in `fetchAndroidVrPlayer`** (Z. 849): Ein hängender Player-Request lässt das Panel dauerhaft auf „Formate werden geladen …" stehen.
4. **Merge-Pfad ohne Status-0-Fallback** (`downloadStreamBytes`, Z. 526): Seit v1.0.91 wird die Ursache geloggt, aber anders als bei `downloadUrl` gibt es keinen Notausgang (nur 403/416 → URL-Refresh).
