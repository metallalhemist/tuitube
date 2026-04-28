# yt-dlp Reference

> Source: https://github.com/yt-dlp/yt-dlp/blob/master/README.md
> Fetched: https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/README.md
> Created: 2026-04-27
> Updated: 2026-04-27

## Overview

`yt-dlp` is a command-line downloader for video and audio URLs. It is callable from any language, including Node.js wrappers, but its normal human stdout is not a stable integration contract. For machine integration, the README recommends using structured outputs such as `-J`, `--print`, `--progress-template`, or `--exec`.

For this project, the most relevant areas are URL metadata extraction, file downloads, subtitle/transcript extraction, output filename control, and dependable subprocess parsing.

## Core Concepts

Command shape: `yt-dlp [OPTIONS] [--] URL [URL...]`.

Structured output: prefer `-J`, `-j`, `--print`, and `--progress-template` over parsing regular progress or status output.

Format selection: `-f` chooses formats, while `-S` changes sort preference for "best". Separate audio/video downloads and merging require `ffmpeg`/`ffprobe`.

Output templates: `-o` controls filenames using fields like `%(title)s`, `%(id)s`, `%(ext)s`; `-P` controls output paths by type.

Subtitles: manual subtitles use `--write-subs`; auto-generated subtitles use `--write-auto-subs`; `--sub-langs` filters language tags; `--sub-format` expresses subtitle format preference.

Post-processing: options such as `--convert-subs`, `--embed-subs`, `--extract-audio`, `--remux-video`, and `--exec` run after extraction/download stages.

## API / Interface

### Integration Outputs

| Option | Purpose |
| --- | --- |
| `-j`, `--dump-json` | Print JSON information for each video. Simulates unless `--no-simulate` is used. |
| `-J`, `--dump-single-json` | Print one JSON document per input URL, with playlist information as a single object. |
| `-O`, `--print [WHEN:]TEMPLATE` | Print a field or output template. Implies quiet mode and usually simulation. |
| `--print-to-file [WHEN:]TEMPLATE FILE` | Append printed template output to a file. |
| `--progress-template [TYPES:]TEMPLATE` | Format progress lines using `info` and `progress` fields. |
| `--newline` | Emit progress as new lines, useful when consuming output streams. |
| `--no-progress` | Suppress progress output. |
| `-v`, `--verbose` | Print debugging data. Useful for diagnostics, not normal parsing. |

Supported `WHEN` values for `--print` follow postprocessor stages such as `video`, `before_dl`, `post_process`, `after_move`, `after_video`, and `playlist`. `after_move:filepath` is useful when post-processing may change the final filename.

### Download and Filesystem Options

| Option | Purpose |
| --- | --- |
| `--no-playlist` | Download only the video when a URL can refer to both a video and playlist. |
| `-I`, `--playlist-items ITEM_SPEC` | Select playlist indexes or ranges. |
| `--download-archive FILE` | Skip IDs already present in an archive and record downloaded IDs. |
| `-N`, `--concurrent-fragments N` | Concurrent DASH/HLS fragment downloads. Default is `1`. |
| `-R`, `--retries RETRIES` | Retry count for downloads. Default is `10`; `infinite` is accepted. |
| `--fragment-retries RETRIES` | Retry count for fragments. Default is `10`; `infinite` is accepted. |
| `--retry-sleep [TYPE:]EXPR` | Sleep between retry types such as `http`, `fragment`, `file_access`, or `extractor`. |
| `--download-sections REGEX` | Download only matching chapters or timestamp ranges. |
| `-P`, `--paths [TYPES:]PATH` | Set home/temp/type-specific paths. Ignored if `--output` is absolute. |
| `-o`, `--output [TYPES:]TEMPLATE` | Set output filename template. |
| `--restrict-filenames` | Restrict filenames to ASCII and avoid spaces/ampersands. |
| `--windows-filenames` | Force Windows-compatible filenames. |
| `--trim-filenames LENGTH` | Limit filename length excluding extension. |
| `--no-overwrites` | Do not overwrite files. |
| `--force-overwrites` | Overwrite video and metadata files; includes `--no-continue`. |
| `--part` / `--no-part` | Use or avoid `.part` files. `.part` is default. |
| `--write-info-json` | Write `.info.json`; the docs warn this may contain personal information. |
| `--clean-info-json` | Remove some internal metadata from infojson. Default. |
| `--cookies FILE` | Read cookies from Netscape-format cookie file. |
| `--cookies-from-browser BROWSER[+KEYRING][:PROFILE][::CONTAINER]` | Load cookies from a supported browser. |

### Subtitle Options

| Option | Purpose |
| --- | --- |
| `--write-subs` | Write subtitle files. |
| `--write-auto-subs` | Write automatically generated subtitles. Alias: `--write-automatic-subs`. |
| `--list-subs` | List available subtitle languages/formats. Simulates unless `--no-simulate` is used. |
| `--sub-format FORMAT` | Subtitle format preference, for example `srt` or `vtt/srt/best`. |
| `--sub-langs LANGS` | Comma-separated language tags or regexes; supports exclusions with `-`. |
| `--convert-subs FORMAT` | Convert subtitles to `ass`, `lrc`, `srt`, or `vtt`; `none` disables conversion. |
| `--sleep-subtitles SECONDS` | Wait before subtitle downloads. |
| `--embed-subs` | Embed subtitles into `mp4`, `webm`, or `mkv`. |

### Format Options

| Option | Purpose |
| --- | --- |
| `-f`, `--format FORMAT` | Select format expression. |
| `-S`, `--format-sort SORTORDER` | Sort formats by fields such as `res`, `height`, `codec`, `size`, `br`, `ext`. |
| `-F`, `--list-formats` | List available formats. Simulates unless `--no-simulate` is used. |
| `--merge-output-format FORMAT` | Preferred merge containers such as `mp4/mkv`; ignored if no merge is needed. |
| `--check-formats` | Ensure selected formats are actually downloadable. |

Selectors include `b`/`best`, `bv`/`bestvideo`, `ba`/`bestaudio`, and `w`/`worst`. Format filters use bracket expressions, for example `[height<=720]`, `[vcodec=none]`, or `[filesize<50M]`. Fallbacks use `/`, multiple downloads use `,`, and merged streams use `+`.

### Post-processing Options

| Option | Purpose |
| --- | --- |
| `-x`, `--extract-audio` | Convert video files to audio-only files; requires `ffmpeg` and `ffprobe`. |
| `--audio-format FORMAT` | Audio output such as `best`, `m4a`, `mp3`, `opus`, `wav`. |
| `--remux-video FORMAT` | Remux without re-encoding when possible. |
| `--recode-video FORMAT` | Re-encode if needed. |
| `--postprocessor-args NAME:ARGS` | Pass args to postprocessors or their executables. Alias: `--ppa`. |
| `--embed-metadata` | Embed metadata; also embeds chapters/infojson when present unless disabled. |
| `--ffmpeg-location PATH` | Path to `ffmpeg` binary or containing directory. |
| `--exec [WHEN:]CMD` | Run a command at a lifecycle stage using output-template syntax. |
| `--use-postprocessor NAME[:ARGS]` | Enable plugin postprocessors at selected stages. |

## Usage Patterns

### Get JSON Metadata Without Downloading

```bash
yt-dlp -J --no-playlist "https://example.com/video"
```

Use `-j` for one JSON object per video and `-J` when playlist-level information should remain grouped.

### Download a Single Video to a Known Directory

```bash
yt-dlp --no-playlist -P "/path/to/output" -o "%(title).200S [%(id)s].%(ext)s" "https://example.com/video"
```

Use a bounded and sanitized output template when the result is surfaced in a UI or stored on user disks.

### Return the Final Filepath After Post-processing

```bash
yt-dlp --no-playlist --print after_move:filepath -P "/path/to/output" "https://example.com/video"
```

This avoids guessing final paths after merge, remux, or subtitle embedding.

### Extract Transcript-oriented Subtitle Files

```bash
yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "en.*,ru" --sub-format "vtt/srt/best" "https://example.com/video"
```

Add `--convert-subs srt` or `--convert-subs vtt` when downstream parsing expects one format.

### Inspect Available Subtitle Languages

```bash
yt-dlp --list-subs "https://example.com/video"
```

Use this before retrying with alternate language filters.

### Prefer a Capped Resolution

```bash
yt-dlp -S "res:720,fps" "https://example.com/video"
```

`-S` changes what "best" means without manually listing extractor-specific format IDs.

## Configuration

yt-dlp accepts the same options in configuration files as on the CLI. Config files are loaded from explicit `--config-locations`, portable locations beside the binary/source, home/current directory locations, user config directories, and system config paths.

Important config controls:

| Option | Notes |
| --- | --- |
| `--ignore-config` | Disable config loading for a run. |
| `--config-locations PATH` | Load a specific config file or directory. Can be repeated. |
| `# coding: ENCODING` | At the start of a config file, overrides default decoding. |
| `--netrc` / `--netrc-location` | Use `.netrc` credentials for supported extractors. |
| `--netrc-cmd` | Run a command that returns netrc-format credentials. |

Config entries must use the same switch spelling as CLI calls, with no whitespace after `-` or `--`.

## Best Practices

1. Treat normal stdout as unstable for program logic; use `-J`, `--print`, or `--progress-template`.
2. Capture `stderr` separately because progress, warnings, and debug output may appear there.
3. Use `--no-playlist` when a UI action means "this video only".
4. Use `--print after_move:filepath` when the caller needs the final path.
5. Prefer `-S` sorting constraints over hard-coded extractor format IDs when possible.
6. Include `ffmpeg`/`ffprobe` in environment checks when merging, subtitle conversion, audio extraction, or remuxing is enabled.
7. Be deliberate with `--write-info-json`; it can include personal information.
8. Use `--sub-langs all,-live_chat` if downloading all subtitles but excluding live chat is important.

## Common Pitfalls

Output filenames can differ from the template after post-processing. Read the final filepath from yt-dlp instead of reconstructing it.

Metadata fields are extractor-dependent. A field usable in an output template or format filter may be absent for some URLs.

`--skip-download` still writes related files such as subtitles when those options are present.

`--all-subs` is listed as not recommended; prefer `--sub-langs all --write-subs`.

Some sites need cookies, impersonation support, or JavaScript runtime support. For YouTube, the README strongly recommends `yt-dlp-ejs` plus a supported JavaScript runtime/engine.

`ffmpeg` must be the binary, not the unrelated Python package named `ffmpeg`.

## Version Notes

This reference was generated from the `master` README on 2026-04-27.

The README states that Python 3.10+ for CPython and 3.11+ for PyPy are supported.

The documented default output template is `%(title)s [%(id)s].%(ext)s`.

The documented default format selector is `bv*+ba/b`.

The README notes that yt-dlp default format sorting prefers higher resolution and better codecs rather than simply higher bitrate.
