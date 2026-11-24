# YouTube Import (After Effects panel)

Paste a YouTube link, press Enter. The video downloads, gets imported into a
`YouTube Downloads` folder in your project, and drops onto the open comp at the
playhead. If no comp is open, it makes one that matches the video.

## 1. Install the tools it uses

The panel uses **yt-dlp** for the download and **ffmpeg** to join the video and audio.

**Windows** (easiest):

```bash
winget install yt-dlp.yt-dlp
```

```bash
winget install Gyan.FFmpeg
```

Or download `yt-dlp.exe` (from github.com/yt-dlp/yt-dlp/releases) and `ffmpeg.exe`
and put both in the same folder as `YouTube Import.jsx`.

**macOS**:

```bash
brew install yt-dlp ffmpeg deno
```

**Deno**: newer yt-dlp versions need a JavaScript runtime for full YouTube support.
If downloads fail or only find low-quality formats, install Deno (`winget install DenoLand.Deno` / `brew install deno`).

## 2. Install the panel

Copy `YouTube Import.jsx` to:

- Windows: `C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\`
- macOS: `/Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/`

Restart After Effects, then open **Window > YouTube Import.jsx** and dock it.

Turn on **Settings > Scripting & Expressions > Allow Scripts to Write Files and Access Network**.

If the panel says yt-dlp/ffmpeg wasn't found, click **Set yt-dlp…** / **Set ffmpeg…** and point at them once. It remembers.

## Using it

- Paste link → Enter (or **Download**). After Effects stays usable while it downloads.
- **Quality**: Best (up to 1080p), 720p, or Audio only.
- **Folder…** picks where files are saved.
- **Update yt-dlp**: YouTube breaks yt-dlp every few weeks. If downloads suddenly fail, click this first.
  (Homebrew/winget installs: run `brew upgrade yt-dlp` or `winget upgrade yt-dlp.yt-dlp` instead.)
- Ctrl/Cmd+Z undoes the import.

## Why max 1080p?

After Effects can't import VP9/AV1 video, which is what YouTube uses for 1440p and 4K.
YouTube only offers H.264 (the format AE can read) up to 1080p, so the panel only
grabs H.264. Supporting 4K would mean re-encoding every download, which is slow and big.

## Troubleshooting

- **"Failed: …"**: the message is yt-dlp's own error. Usually fixed by updating yt-dlp.
  Full log is in your temp folder (`ytimport_*.log`).
- **"No H.264 version…"**: pick a lower quality.
- **Age-restricted/private videos** need cookies; not supported in this version.

Only download videos you have the rights to use (your own, licensed, or fair use).
