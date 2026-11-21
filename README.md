# LateFrame

**English** | [日本語](README.ja.md)

Chrome extension that delays **YouTube video** (not audio) so lip sync matches wireless / Bluetooth headphone lag.

## Why

Bluetooth headphones often play audio a bit late. YouTube keeps video and audio locked together, so shifting playback time moves both. LateFrame leaves the audio alone and shows an older video frame instead.

## Install (developer / unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this repository folder (the one with `manifest.json`)
4. Reload any YouTube tabs that were already open

Chrome Web Store packaging is not required to try it locally.

## Usage

1. Connect wireless headphones and play a YouTube video
2. Open the LateFrame popup from the toolbar
3. Turn **Enabled** on
4. Raise **Video delay** from 0 until mouth movement matches the audio  
   Presets (0 / 100 / 200 / 300 ms) help you get close quickly

At **0 ms**, LateFrame does nothing and YouTube looks normal.

## How it works

1. The original `<video>` keeps playing (audio unchanged); its pixels are hidden when delay is active
2. Frames are buffered with `requestVideoFrameCallback` when available
3. A canvas overlay draws a frame that is N milliseconds older than the audio

## Permissions

| Permission | Why |
|------------|-----|
| `storage` | Save enabled state and delay amount |
| `https://www.youtube.com/*` | Run on YouTube watch pages |

No account, analytics, or network calls beyond what the page already does.

## Limitations

| Area | Notes |
|------|--------|
| Captions | YouTube captions are separate DOM; they are not delayed with the video |
| CPU / memory | Higher resolution and frame rate cost more |
| Live streams | Buffering is less stable; sync can drift |
| Miniplayer / PiP | Normal watch page is the priority |
| Ads | Delay is paused while an ad is showing |
| Sites | YouTube only (`https://www.youtube.com/*`) |

## Troubleshooting

1. **Delay still at 0 ms** — Raise the slider (0 ms is intentionally a no-op)
2. **Installed but nothing happens** — Reload the YouTube tab once after installing or updating
3. **Briefly looks unchanged** — About 0.3–0.5 s of warmup fills the frame buffer; then a `LateFrame: +Nms` label appears
4. **Hard to notice** — Try 200–300 ms first, then fine-tune

Quick check: search the page DOM for `.late-frame-overlay`. If the overlay exists and the status label shows a delay, the canvas path is running.

## Contributing

Issues and pull requests are welcome — small fixes count.

Especially helpful:

- Bug reports with steps to reproduce (and Chrome version if you can)
- Fixes when YouTube’s player DOM changes
- Docs clarifications or better install / usage wording

Open an issue first if you want to discuss a larger change. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and a short test checklist.

## License

[MIT](LICENSE)
