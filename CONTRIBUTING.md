# Contributing

Thanks for taking an interest. Issues and pull requests are welcome — including small docs fixes.

**Japanese is welcome for issues**（Issue は日本語でも OK）.

Personal editor / AI tool preferences belong in your **global gitignore** (`git config --global core.excludesFile`). The repo only ignores project junk and a few local override files (see `.gitignore`).

## Setup

1. Clone this repository
2. In Chrome, open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the repo root (folder with `manifest.json`)
3. Open or reload a YouTube watch page

After changing content scripts, click **Reload** on the extension card, then reload the YouTube tab.

## Manual test checklist

- [ ] Delay works on a normal watch page
- [ ] Slider changes apply without reloading the tab
- [ ] Navigating to another video re-attaches correctly
- [ ] Fullscreen: canvas follows the player
- [ ] Hover shows the progress bar / controls
- [ ] Disabling LateFrame restores the normal video
- [ ] Ads: delay pauses while an ad is showing, resumes afterward

## Branching

- Default branch: `master`
- Work on a feature/fix branch; open a pull request into `master`
- Suggested names: `fix/...`, `feat/...`, `docs/...` (optional issue number, e.g. `fix/1-captions-visible`)

## Pull requests

- Keep changes focused
- For bugs, include reproduction steps (and Chrome version when relevant)
- For larger ideas (other sites, architecture changes), open an issue first

## Code notes

- Manifest V3; no ES module `import` in content scripts (scripts are listed in order in `manifest.json`)
- Shared constants live in `src/late-frame-constants.js` as `LATE_FRAME`
- Frame buffering / canvas: `src/content/frame-delay.js`
- YouTube player attach + settings: `src/content/youtube-delay.js`
