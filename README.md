# xYTDownloader — usrscript

One-click YouTube video downloader userscript for Tampermonkey / Violentmonkey.

![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-xYTDownloader-3ea6ff)

---

## 🌐 Description / Beschreibung / Описание

**English 🇬🇧**

One-click YouTube video downloader userscript. Open any video, Short or finished livestream, click the small download button, pick a quality — done. No external download API, no API keys. Direct VISIONOS Innertube client, automatic DASH merging for high resolutions with sound.

**Deutsch 🇩🇪**

YouTube-Downloader-Userscript mit einem Klick. Video, Short oder beendeten Livestream öffnen, auf den kleinen Download-Button klicken, Qualität wählen — fertig. Keine externe Download-API, keine API-Schlüssel. Direkter VISIONOS-Innertube-Client, automatisches DASH-Merging für hohe Auflösungen mit Ton.

**Русский 🇷🇺**

Пользовательский скрипт для скачивания видео с YouTube в один клик. Откройте любое видео, Short или завершённый стрим, нажмите маленькую кнопку загрузки, выберите качество — готово. Без внешних API и ключей. Прямой Innertube-клиент VISIONOS, автоматическое слияние DASH для высоких разрешений со звуком.

---

## Features / Funktionen / Возможности

- Works on `/watch` and `/shorts` (including scrolling between Shorts), plus `/live` (finished livestreams / VODs)
- All qualities up to 4K, each with audio
- Automatic DASH merging for high resolutions (video + audio into one MP4)
- Direct download from YouTube (VISIONOS Innertube client — direct googlevideo streams, no external API)
- Library-free fMP4 box merging — no ffmpeg needed
- Flat quality list (360p → 2160p), real progress bar, correct file names
- Small, unobtrusive download button bottom-right of the player (60 % opacity over the video, 100 % on hover)

## Installation / Установка

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [Greasy Fork page](https://greasyfork.org/de/scripts/589972-xytdownloader) and click **Install** (or import the `.user.js` file via Tampermonkey → Utilities → Import).
3. Reload YouTube — the download button appears.

## Usage / Verwendung / Использование

1. Open any YouTube video (`/watch`), Short (`/shorts`) or finished livestream (`/live`).
2. Click the download button (bottom-right of the player, or in the action bar).
3. Pick a quality — the file is saved to your download folder.

## How it works / Technik / Как это работает

The script talks directly to YouTube's Innertube API using the **VISIONOS** client, so no third-party download service is involved. Higher resolutions are DASH streams (separate video + audio); the script merges them client-side into one MP4 with sound using a small fMP4 box merger.

- Progressive formats are downloaded as-is.
- DASH video-only streams are merged automatically with the best MP4 audio track (itag 140 preferred).
- WEBM/Opus audio is not supported for merging (MP4 container only).

## Development / Entwicklung / Разработка

- Working file: `xyt-downloader.user.js` (project root)
- Versioned builds: `Ausgabe/` (local only, not in this repo)
- Syntax check: `node --check xyt-downloader.user.js`
- Project docs: `BERICHT.md` (per-version changelog), `DOKUMENTATION_ENTWICKLUNGSSTAND.md` (architecture), `ANALYSE_*.md` (historical analyses)

## Security note / Sicherheitshinweis / Примечание о безопасности

The `API_KEY` constant (deactivated savenow.to fallback path) is **replaced with a placeholder** in this repository and in all public sources (including the published Greasy Fork version) for security reasons. The savenow fallback is disabled anyway — the primary path is the VISIONOS client without any API key.

## License / Lizenz / Лицензия

MIT
