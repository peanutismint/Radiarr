# Radiarr 📻 (`v0.8`)

> **Your personal music library, turned into your dream radio dial.**  
> Continuous, deterministic virtual "live" radio stations crafted from your **Plex Media Server**, local hard drive, or network **NAS**—synced across every device in your house.

[![Version](https://img.shields.io/badge/version-v0.8.0-indigo.svg)](https://github.com/peanutismint/radiarr/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Docker-emerald.svg)](https://github.com/peanutismint/radiarr/releases)

---

## Why Radiarr?

You spent years ripping CDs, hoarding FLACs, and meticulously curating gigabytes of music. So why do you still end up:
1. Staring blankly at an endless list of artists with decision paralysis?
2. Playing the exact same comfort playlist for the 400th time?
3. Surrendering to streaming algorithms that keep pushing corporate pop on you?

**Radiarr** is *Tunarr*, but built from the ground up for music lovers. It transforms your personal collection into a living, breathing radio dial where every station is curated by you.

Flip on Channel 1 for an **All-Library Shuffle**, jump to Channel 4 for an **80s New Wave & Post-Punk** channel with silky 4-second crossfades, switch to Channel 12 for a **Led Zeppelin Chronological Discography**, or let your **24-Hour Daypart Station** wake you up with acoustic coffeehouse tracks before ramping into upbeat rock for the afternoon.

Best of all? **It's mathematically scheduled.** Zero CPU is burned when you aren't listening. But when you tune in from your phone, browser, or car, you jump into the song at the exact second it’s playing on the clock—synced everywhere.

---

## What Makes It Special

### 📻 Truly Deterministic "Live" Radio
Every channel runs on an exact mathematical timeline anchored to a station seed and epoch timestamp. When you tune in, there's no waiting for a playlist to shuffle or an indexer to calculate—audio starts instantly. If you listen on your laptop and walk to your car, you'll hear the exact same song at the exact same beat.

### 🎚️ Dual-Deck Gapless Playback & Smart Crossfades
No awkward silences between songs! Radiarr's dual-deck audio engine preloads upcoming tracks 25 seconds ahead of time.
- **Full-album discographies** play completely gapless—transitions across tracks on *The Dark Side of the Moon* or *Abbey Road* sound identical to vinyl or CD.
- **Shuffle & Era channels** feature smooth, customizable crossfades (`2s`, `3s`, `5s`, or `8s`).

### 📦 Supercharged Bulk Station Wrangling *(New in v0.8!)*
Managing dozens of channels should be fun, not tedious:
- **Batch Drag & Drop**: Check off 5 stations and drag any one of them to drop the entire group anywhere in your lineup, with relative order locked in.
- **Batch Shifting via Arrows**: Click the Up or Down arrow on any selected station to bump the entire group up or down together.
- **Smooth Auto-Scroll**: Drag a station near the top or bottom of the screen and the list glides up or down smoothly without runaway speed.
- **En Masse Actions**: Bulk duplicate, reshuffle schedules, turn on/off, bulk-switch play modes, or delete with safety confirmation.

### 🕹️ Real Station Curation & 24-Hour Dayparting
- **Three Playback Personalities**:
  - **Track Shuffle**: Powered by a smart shuffle bag that plays every eligible song once before repeating.
  - **Album Shuffle**: Shuffles whole albums while keeping their tracklists strictly in sequence.
  - **Straight**: Chronological discography order by release year and disc/track number.
- **Rule Builder**: Filter by music libraries, artists, albums, genres, or release decade (e.g. `1970–1979`).
- **Daypart Schedules**: Automatically adjust a station’s mood by time of day (chill in the morning, high-energy in the afternoon, mellow ambient after 8 PM).

### 🏎️ Car & Bluetooth Steering Wheel Freedom
Radiarr fully hooks into the browser **MediaSession API**. When streaming over Bluetooth in your car or wearing earbuds, tapping the **Next Track / Previous Track** buttons on your steering wheel flips to the **Next / Previous Radio Station**—just like physical car presets!

### 📺 IPTV & EPG Integration (M3U + XMLTV)
Plug Radiarr straight into **Jellyfin**, **Plex Live TV**, **Kodi**, **TiviMate**, or **VLC**. Radiarr exports standard M3U channel playlists (`/channels.m3u`) and continuous XMLTV electronic program guides (`/xmltv.xml`).

### 🧰 Flight Recorder Diagnostics & Logs *(New in v0.8!)*
Got a song that refused to stream or a Plex connection that flaked? Head to **Settings → Diagnostics & Logs** to see a realtime timeline of playback events, transcode status, connection tests, and one-click diagnostics bundle export.

### 🖥️ Native Desktop & Docker Ready
- **Desktop**: Run natively on **Windows**, **macOS** (Universal Apple Silicon + Intel), and **Linux**. Minimize to the system tray so music plays in the background without cluttering your dock.
- **Docker**: Drop a `docker-compose.yml` file onto your unRAID, TrueNAS, or Synology NAS and you're off to the races.

---

## Quick Start

### 1. Standalone Desktop App (Windows, macOS, Linux)

Grab the latest installer or portable binary from [**GitHub Releases**](https://github.com/peanutismint/radiarr/releases):

- 🪟 **Windows 10 / 11**: `Radiarr-Setup-0.8.0.exe` (installer) or `Radiarr-0.8.0-portable.exe`
- 🍎 **macOS**: `Radiarr-0.8.0.dmg` (Universal binary for Apple Silicon M1/M2/M3/M4 and Intel)
- 🐧 **Linux**: `Radiarr-0.8.0.AppImage` or `radiarr_0.8.0_amd64.deb`

To build the desktop bundle from source:
```bash
npm install
npm run desktop:build
npm run desktop:pack   # Generates unpacked desktop binaries in release/
# or:
npm run desktop:dist   # Packages ready-to-ship installers (.exe, .dmg, .AppImage)
```

---

### 2. Docker Compose (Home Server & NAS)

1. Grab `docker-compose.yml`:
   ```yaml
   services:
     radiarr:
       image: ghcr.io/peanutismint/radiarr:latest
       container_name: radiarr
       restart: unless-stopped
       ports:
         - "8484:8484"
       environment:
         - TZ=UTC
         - PORT=8484
       volumes:
         - ./data/config:/config
         - /path/to/your/music:/music:ro  # Optional if using Plex exclusively
   ```
2. Spin it up:
   ```bash
   docker compose up -d
   ```
3. Open `http://localhost:8484` (or your server's IP address) in any browser!

---

### 3. Local Development (Node.js 22+)

1. Ensure **Node.js 22+** (uses built-in `node:sqlite`) and **FFmpeg** are installed.
2. Clone and install:
   ```bash
   git clone https://github.com/peanutismint/radiarr.git
   cd radiarr
   npm install
   ```
3. Start the Vite + Express dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` and start curating your stations!

---

## Repository Structure

```text
radiarr/
├── docs/
│   └── APP_GUIDE.md                   # Comprehensive guide, dayparting recipes & shortcuts
├── src/
│   ├── App.tsx                        # Audio engines, global state & MediaSession routing
│   ├── main.tsx                       # React DOM entry point
│   ├── desktop/
│   │   ├── main.ts                    # Electron tray icon, window lifecycle & native IPC
│   │   └── preload.ts                 # Context bridge for native OS file pickers
│   ├── client/
│   │   ├── components/
│   │   │   ├── NowPlayingView.tsx     # Full-screen vinyl/CD art, live indicator & station cards
│   │   │   ├── GuideView.tsx          # Interactive EPG grid with click-to-timeshift
│   │   │   ├── CurationView.tsx       # Channel manager, multi-select drag & drop, rule builder
│   │   │   ├── DiagnosticsTab.tsx     # Realtime playback event logs & diagnostics export
│   │   │   ├── SettingsView.tsx       # Libraries, NAS mount helper, auto-backups & themes
│   │   │   ├── UsersManagementTab.tsx # Multi-user management & role-based access control
│   │   │   └── PlayerBar.tsx          # Persistent bottom transport bar & crossfading
│   │   └── hooks/
│   │       └── useTheme.ts            # Light / Dark / System theme sync
│   ├── server/
│   │   ├── audio/
│   │   │   ├── StreamService.ts       # Byte-range audio streaming & Plex proxy
│   │   │   ├── PlaybackLogService.ts  # Realtime flight recorder & playback error tracking
│   │   │   └── TranscodeCache.ts      # On-the-fly FFmpeg transcoding cache
│   │   ├── db/
│   │   │   └── index.ts               # SQLite schema & zero-dependency node:sqlite driver
│   │   ├── engine/
│   │   │   ├── ScheduleEngine.ts      # Deterministic EPG math & station generators
│   │   │   └── DaypartResolver.ts     # Wall-clock 24-hour daypart transitions
│   │   └── routes/
│   │       ├── stations.ts            # Station CRUD, batch moves, EPG & M3U streams
│   │       ├── diagnostics.ts         # Diagnostics log streamer & health checks
│   │       ├── users.ts               # User accounts & RBAC session management
│   │       └── libraries.ts           # Plex OAuth PIN flow & local scanner
│   ├── shared/
│   │   ├── stationVisuals.ts          # Category formulas, swatch palette & batch move math
│   │   └── types.ts                   # Unified types & APP_VERSION constant
│   └── tests/
│       ├── batch.test.ts              # Unit tests for multi-station drag, drop & nudge math
│       ├── schedule.test.ts           # Deterministic PRNG & looping timeline verification
│       └── backup.test.ts             # Catalog backup and restore verification
├── server.ts                          # Full-stack Express + Vite server entry
├── radiarr.dockerfile                 # Lightweight multi-stage Node 22 Alpine + FFmpeg build
└── package.json
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8484` (Docker) / `3000` (Dev) | Port for the web interface and API server |
| `TZ` | `UTC` | Timezone used for EPG schedules and 24-hour dayparts |
| `CONFIG_DIR` | `/config` (or `./data/config`) | Location of `radiarr.db`, artwork cache, and transcode data |
| `MUSIC_DIR` | `/music` (or `./data/music`) | Root folder scanned for local music libraries |
| `TRANSCODE_BITRATE_KBPS` | `192` | MP3 bitrate for non-browser-native formats (FLAC/ALAC/WMA) |
| `TRANSCODE_CACHE_MAX_MB` | `2048` | Max disk space (MB) reserved for cached transcodes |
| `STREAM_BITRATE_KBPS` | `192` | Bitrate for external continuous `/api/stations/:id/stream.mp3` feeds |
| `RADIARR_NAS_HOST` | `192.168.1.50` | Default host/IP for NAS SMB/CIFS network share mount helper |
| `RADIARR_NAS_USER` | `admin` | Default username for NAS SMB/CIFS network share mount helper |
| `RADIARR_NAS_PASSWORD` | *(empty)* | Default password for NAS SMB/CIFS network share mount helper |

---

## Authentication, Security & Storage Note

- **Open Access by Default**: Out of the box, Radiarr is designed for home LANs and private VPNs (Tailscale, WireGuard). Everyone on your network connects with immediate **Admin** access without needing to log in—meaning zero password friction on smart TVs, Apple TVs, or car head units.
- **Optional Multi-User & Role-Based Access Control (RBAC)**: If you share Radiarr with others and want to protect your stations, you can enable User Accounts in **Settings → Users**. Once enabled, users log in as either **Admin** (full curation, station creation, and system settings) or **Listener** (read-only playback and interactive guide).
- **NAS Credential Storage**: If you configure SMB/CIFS network share credentials in the web UI, the password is stored in **plain text** within the internal SQLite settings database (`radiarr.db`). Ensure filesystem permissions on your `config` directory or Docker volume are restricted to trusted administrators.
- **Remote Access**: When accessing Radiarr outside your home, place it behind a secure reverse proxy (such as Authelia, Authentik, or Cloudflare Access) or use a private mesh VPN like Tailscale.

---

## Community & Contributing

Built something cool with Radiarr or have a feature idea?
- 📖 Read the full [**Application Guide (`docs/APP_GUIDE.md`)**](./docs/APP_GUIDE.md) for daypart examples, keyboard shortcuts, and Plex tips.
- 🐛 Found a bug or want to request a feature? Open an issue on GitHub.
- ⭐️ If Radiarr brings your music collection back to life, give the repo a star!
