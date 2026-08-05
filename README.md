# xYTDownloader — usrscript

One-click YouTube video downloader userscript for Tampermonkey / Violentmonkey.

![Greasy Fork](https://img.shields.io/badge/Greasy%20Fork-xYTDownloader-3ea6ff)

## Features

- Works on `/watch` and `/shorts` (including scrolling between Shorts)
- All qualities up to 4K, each with audio
- Automatic DASH merging for high resolutions (video + audio into one MP4)
- Direct download from YouTube (ANDROID_VR Innertube client — same method JDownloader 2 uses)
- Library-free fMP4 box merging — no ffmpeg needed
- Flat quality list (360p → 2160p), real progress bar, correct file names
- Small, unobtrusive download button bottom-right of the player (60 % opacity over the video, 100 % on hover)

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [Greasy Fork page](https://greasyfork.org/de/scripts/589972-xytdownloader) and click **Install** (or import the `.user.js` file via Tampermonkey → Utilities → Import).
3. Reload YouTube — the download button appears.

## Usage

1. Open any YouTube video (`/watch`) or Short (`/shorts`).
2. Click the download button (bottom-right of the player, or in the action bar).
3. Pick a quality — the file is saved to your download folder.

## How it works

The script talks directly to YouTube's Innertube API using the **ANDROID_VR** client, so no third-party download service is involved. Higher resolutions are DASH streams (separate video + audio); the script merges them client-side into one MP4 with sound using a small fMP4 box merger.

- Progressive formats are downloaded as-is.
- DASH video-only streams are merged automatically with the best MP4 audio track (itag 140 preferred).
- WEBM/Opus audio is not supported for merging (MP4 container only).

## Development

- Working file: `xyt-downloader.user.js` (project root)
- Versioned builds: `Ausgabe/` (local only, not in this repo)
- Syntax check: `node --check xyt-downloader.user.js`
- Project docs: `BERICHT.md` (per-version changelog), `DOKUMENTATION_ENTWICKLUNGSSTAND.md` (architecture), `ANALYSE_*.md` (historical analyses)

## Security note

The `API_KEY` constant (deactivated savenow.to fallback path) is **replaced with a placeholder** in this repository for security reasons. The real key only exists in the published Greasy Fork version — the savenow fallback is disabled anyway (primary path is the ANDROID_VR client).

## License

MIT
