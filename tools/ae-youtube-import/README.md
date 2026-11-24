# YouTube Import (After Effects extension)

A dockable After Effects panel. Paste a YouTube link and it downloads the video,
imports it into a `YouTube Downloads` folder in your project, and drops it onto
the open comp at the playhead. If no comp is open, it makes one that matches the video.

- Pasting a link into the box starts the download right away (Enter / **Download** also work).
- **Paste & Download** grabs the link from your clipboard in one click.
- Live progress bar and a **Cancel** button. After Effects stays usable while it downloads.
- Ctrl/Cmd+Z undoes the import.

## 1. Install yt-dlp and ffmpeg

**Windows**

```bash
winget install yt-dlp.yt-dlp
```

```bash
winget install Gyan.FFmpeg
```

```bash
winget install DenoLand.Deno
```

**macOS** (needs Homebrew)

```bash
brew install yt-dlp ffmpeg deno
```

Deno is a JavaScript runtime that newer yt-dlp versions use to handle YouTube. Without it, some videos may fail or only show low-quality formats.

You can instead put `yt-dlp(.exe)` and `ffmpeg(.exe)` inside `extension/bin/` before installing.

## 2. Install the extension

- **Windows**: double-click `install-windows.bat`
- **macOS**: double-click `install-mac.command` (if macOS blocks it: right-click → Open)

The installer copies `extension/` into your user's CEP extensions folder and turns on
`PlayerDebugMode`, which After Effects requires before it will load an extension that isn't signed.

Restart After Effects, then open **Window → Extensions → YouTube Import** and dock it.

If the **Setup** section says yt-dlp or ffmpeg is "not found", click **Set…** and point at the file. It remembers.

## Why max 1080p?

After Effects can't import VP9/AV1 video, which is what YouTube uses above 1080p. YouTube only
offers H.264 (which After Effects reads natively) up to 1080p, so the panel only downloads H.264.
4K would mean re-encoding every download.

## Troubleshooting

- **Downloads suddenly fail**: YouTube breaks yt-dlp every few weeks. Click **Update yt-dlp**
  (winget/Homebrew installs: `winget upgrade yt-dlp.yt-dlp` / `brew upgrade yt-dlp`).
- **"No H.264 version…"**: pick a lower quality.
- **Panel doesn't appear in Window → Extensions**: re-run the installer, then fully quit and reopen After Effects.
- **Panel is blank or broken**: with After Effects open, visit `http://localhost:8099` in Chrome to see the panel's console errors.
- Age-restricted/private videos aren't supported.

## Files

```
extension/
  CSXS/manifest.xml   extension definition (AE 2019+)
  index.html, css/    panel UI
  js/main.js          runs yt-dlp (Node.js), progress, clipboard
  host/index.jsx      ExtendScript: import + place on timeline
  .debug              enables the localhost:8099 inspector
```

Only download videos you have the rights to use (your own, licensed, or fair use).
