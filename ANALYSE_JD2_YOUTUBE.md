# JDownloader2 YouTube-Download-Analyse (für xYT-Downloader-Userscript)

**Datum:** 2026-08-04 · **Testvideo:** `APDe7dkk1Ys` („Cinematic Video for OLED Display Test | 16K HDR 240fps Dolby Vision (4K Video • 8K ULTRA HD TV)", Kanal 8K Planet)
**Quelle:** JD2-Logs `E:\Downloads\Rapid\JDownloader2\logs\1785853800232_...` (Crawler `TbCmV2`, Downloader `YoutubeDashV2`, `DownloadWatchDog`)
**Ziel:** Mechanismen von JDownloader2 für Größenermittlung + Fortschrittsanzeige identifizieren und auf das Userscript übertragen.

---

## 1. Netzwerk-Protokoll (zeitlicher Ablauf)

### Phase A — Link-Erkennung & Video-Analyse (Crawler, `TbCmV2`)

**A1: Watch-Seite laden (wie ein Browser)**
```
GET /watch?bpctr=9999999999&has_verified=1&hl=en&v=APDe7dkk1Ys&gl=US HTTP/1.1
Host: www.youtube.com
User-Agent: Mozilla/5.0 (Windows NT 10.0; WOW64; rv:76.0) Gecko/20100101 Firefox/76.0
Accept-Encoding: gzip, deflate, br
Cookie: PREF=f1=50000000&hl=en; hideBrowserUpgradeBox=true; SOCS=CAI
→ HTTP/1.1 200 OK, Content-Type: text/html (81 ms)
```
→ Antwort enthält `ytInitialPlayerResponse` mit `streamingData.adaptiveFormats` (itag 315/401 2160p60, 308/400 1440p60 … inkl. `contentLength` je Format, z. B. 15.252.742.714 B für itag 315).

**A2: Innertube-Player-API (Schlüssel zum Erfolg!)**
```
POST /youtubei/v1/player?prettyPrint=false HTTP/1.1
Host: www.youtube.com
User-Agent: com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip
X-Youtube-Client-Name: 28
X-Youtube-Client-Version: 1.65.10
X-Goog-Visitor-Id: CgtiQWdJYUNpM2xzYyjO8MfT...
Referer: https://www.youtube.com/watch?...&v=APDe7dkk1Ys
Content-Type: application/json; charset=UTF-8
Content-Length: 1376

{"context":{"client":{"clientName":"ANDROID_VR","clientVersion":"1.65.10",
  "deviceMake":"'Oculus","deviceModel":"'Quest 3","androidSdkVersion":32,
  "userAgent":"com.google.android.apps.youtube.vr.oculus/1.65.10 (...) gzip",
  "osName":"Android","osVersion":"12L","hl":"en","timeZone":"UTC","utcOffsetMinutes":0}},
 "videoId":"APDe7dkk1Ys","playbackContext":{"contentPlaybackContext":{...}}}
```
→ Antwort liefert **direkte, signierte Stream-URLs** (`https://rr2---sn-...googlevideo.com/videoplayback?expire=...&c=ANDROID_VR&...&sig=...`).

> **Kernbefund:** Der **ANDROID_VR-Client** (Client-Name 28, Oculus-Quest-3-UA) liefert funktionierende direkte URLs **ohne POT-Token und ohne 403** — im Gegensatz zum WEB-Client (der in unserem früheren Test 403/UNPLAYABLE lieferte).

### Phase B — Größenermittlung (Downloader, `YoutubeDashV2`)

**B1: HEAD-Request pro Format**
```
HEAD /videoplayback?expire=1785875631&ei=...&itag=299&...&c=ANDROID_VR&...&clen=3579972190&... HTTP/1.1
→ 302 Redirect zu rr5---sn-u14g55-cw.googlevideo.com (CDN-Umleitung)
→ HEAD (final): HTTP/1.1 200 OK
  Accept-Ranges: bytes
  Content-Length: 3579972190        ← Video itag 299 (≈3,58 GB)
→ HEAD itag=140: Content-Length: 117872312  ← Audio (≈117 MB)
```
→ **Größe wird per HEAD-Request vor dem Download exakt ermittelt** (`Content-Length`); zusätzlich steckt `clen=` bereits im URL-Parameter der videoplayback-URL.

### Phase C — Download (Chunked, parallel)

```
GET /videoplayback?...&itag=299&...&range=0-5033163 HTTP/1.1        → 206/200 (Chunk 1, 0–4,8 MB)
GET /videoplayback?...&itag=299&...&range=5033164-9751755 HTTP/1.1  → Chunk 2 (4,8–9,3 MB)
GET ...&range=9751756-... HTTP/1.1                                   → Chunk 3 …
```
- **Chunk-Größe ≈ 4,8 MB** (5.033.164 B), mehrere Verbindungen parallel (BrowserID 20/21/22 …)
- **Video und Audio getrennt** (itag 299 Video + itag 140 Audio), werden per **ffmpeg** gemerged (`AbstractFFmpegBinary`)
- 283 HTTP-200/206-Responses im Log; Zieldatei `... (1080p_60fps_H264-128kbit_AAC).mp4.part` (3,569 GiB)

### Phase D — Fortschrittsberechnung

- JD2 kennt die **exakte Gesamtgröße** aus `Content-Length` (HEAD) bzw. `clen`-Parameter.
- JD2 zählt die **empfangenen Bytes pro Chunk** (`chunkProgress`, `current` gegen `size` im `DownloadController`) — Fortschritt = Σ empfangene Bytes / Gesamtgröße.
- **Deterministischer, statisch wachsender Balken 0→100 %** (kein Sweep), weil die Größe VOR dem Download feststeht und jede empfangene Byte-Menge exakt zugeordnet wird.

---

## 2. Vergleichstabelle: JDownloader2 vs. xYT-Downloader-Userscript (v1.0.18)

| Aspekt | JDownloader2 | Userscript v1.0.18 | Differenz / Konsequenz |
|---|---|---|---|
| **Video-API** | `POST /youtubei/v1/player` mit **ANDROID_VR**-Client (Name 28, Oculus-UA) → **direkte signierte URLs** | savenow.to → dubs.io (externe Download-API); WEB-Client liefert im Browser 403/keine URLs | **Größter Unterschied:** JD2 bekommt echte Stream-URLs, wir nicht |
| **Größenermittlung** | **HEAD-Request** auf die Stream-URL → `Content-Length` (exakt, vor Download) | HEAD/Range-Probe auf die savenow-`download_url` (parallel, 8 s Timeout) | JD2: zuverlässig (Server unterstützt HEAD). savenow: HEAD kann fehlschlagen → `expectedSize=0` → MB-Modus |
| **Download-Methode** | **Chunked** (Range, 4,8 MB, parallel, mehrere Verbindungen) + ffmpeg-Merge | **Ein-Request-Ganzdatei** (arraybuffer), kein Range, kein Merge nötig (API liefert fertige Datei) | JD2: schneller, robust gegen Abbruch; Userscript: einfacher, aber ein Abbruch = Neustart |
| **Fortschrittsquelle** | **Bytes gezählt** (chunkProgress) gegen bekannte `Content-Length` | `GM_xmlhttpRequest.onprogress` (`loaded`/`total`) + `expectedSize`-Fallback | JD2: immer exakt; Userscript: abhängig davon, ob `total`/`expectedSize` verfügbar |
| **Balken** | statisch 0→100 %, deterministisch | indet-Sweep nur solange `expectedSize==0`, dann statisch (v1.0.18) | Konzept gleich; Restrisiko nur bei fehlender Größe |
| **Abweichung Größe** | 0 % (Content-Length = tatsächlich) | bisher 0 % im Test, aber `expectedSize=0` möglich → keine Prüfung | JD2 überlegen |
| **Wiederverbindung** | Chunk-basiert (Fortsetzen möglich) | Ganzdatei (kein Resume) | JD2 robuster |

---

## 3. Spezifikation für die korrekte Userscript-Implementierung (abgeleitet)

### 3.1 Direkte Stream-URLs via ANDROID_VR-Innertube-Client (Priorität 1 — löst alles)

Das Userscript sollte die savenow-API **ersetzen oder ergänzen** durch einen direkten Innertube-Call:

```
POST https://www.youtube.com/youtubei/v1/player?prettyPrint=false
Headers:
  User-Agent: com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip
  X-Youtube-Client-Name: 28
  X-Youtube-Client-Version: 1.65.10
  Content-Type: application/json; charset=UTF-8
Body: {"context":{"client":{"clientName":"ANDROID_VR","clientVersion":"1.65.10",
      "deviceMake":"'Oculus","deviceModel":"'Quest 3","androidSdkVersion":32,
      "userAgent":"...","osName":"Android","osVersion":"12L","hl":"de","timeZone":"Europe/Berlin","utcOffsetMinutes":120}},
      "videoId":"<VIDEO_ID>","playbackContext":{"contentPlaybackContext":{"vis":0}}}
```
- Antwort: `streamingData.formats`/`adaptiveFormats` mit **`url`-Feldern** (direkte googlevideo-URLs) und `contentLength`.
- **Größe dann aus `contentLength`** des gewählten Formats — exakt, VOR dem Download (kein HEAD nötig, kein savenow).
- **Fortschritt:** `GM_xmlhttpRequest.onprogress` mit `total` (bzw. `contentLength` als Fallback) → **statischer Balken 0→100 %**, Byte-genau wie JD2.
- **Merge:** Video-only + Audio-only → ffmpeg.wasm oder: progressive Formate nutzen (falls vorhanden) bzw. dem Nutzer getrennte Dateien anbieten (dokumentierte Einschränkung).

### 3.2 Wenn savenow-API beibehalten wird (Fallback-Weg)

- **Größenermittlung verbessern:** HEAD auf die `download_url` erzwingen (bereits in v1.0.17); falls HEAD 405/kein Content-Length → Range-Probe; falls beides 0 → MB-Anzeige + Sweep (Status quo, akzeptabel).
- **Fortschritt:** `pct = loaded / (total || expectedSize)` — bereits implementiert (v1.0.15–1.0.18).

### 3.3 Empfehlung

| JD2-Mechanismus | Direkt übernehmbar? | Anpassung |
|---|---|---|
| ANDROID_VR-Innertube-Call | **Ja** (Kern!) | via `GM_xmlhttpRequest` (CORS-frei); @connect für `youtubei.googleapis.com`/`www.youtube.com` nötig |
| HEAD → Content-Length | Ja | bereits vorhanden; durch `contentLength` aus API-Antwort ersetzbar (zuverlässiger) |
| Chunked-Download (Range) | Optional | komplex (Mehrfach-Connections); für Userscript nicht nötig — `onprogress` reicht |
| Byte-Zählung → statischer Balken | Ja | bereits in v1.0.18 umgesetzt (determinateLocked) |
| ffmpeg-Merge | Nur mit ffmpeg.wasm | ~30 MB; alternativ getrennte Downloads oder progressive Formate |

**Kernaussage:** Der entscheidende Hebel ist der **ANDROID_VR-Client** — damit bekommt das Userscript echte Stream-URLs + `contentLength`, und der Fortschrittsbalken wird genauso zuverlässig wie bei JDownloader2 (statisch, 0→100 %, exakte Größe), ganz ohne externe savenow-API.
