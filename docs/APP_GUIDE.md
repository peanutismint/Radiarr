# Radiarr Application Guide (`v0.7`)

This guide walks through every part of **Radiarr**, from connecting your music sources (Plex or Local/NAS folders) to curating stations, using the interactive Electronic Program Guide (EPG), and listening in the car via Bluetooth.

---

## 1. Connecting Your Music Libraries (`Settings → Libraries`)

Navigate to **Settings** in the top navigation bar. The **Libraries** tab opens with **Plex Server** selected by default, alongside **Local Folders**.

### Connecting a Plex Media Server (Default)
1. Click **Sign in with Plex** to launch the official Plex authentication popup.
2. Once signed in, Radiarr automatically discovers your available Plex Media Servers (preferring direct local network connections when available, with automatic fallback).
3. Select your server from the dropdown to list its Music sections (e.g., *Albums*, *Singles*, *Soundtracks*).
4. Click **Connect & Scan** next to any Plex Music library you want in Radiarr.
   - Radiarr indexes track metadata and durations directly from the Plex API in seconds.
   - Audio and album art stream directly from your Plex server on demand without copying files.

### Connecting Local Folders or a Network NAS
1. Switch to the **Local Folders** sub-tab under **Settings → Libraries**.
2. Any immediate subfolder inside `/music` (such as `/music/albums` or `/music/singles`) is automatically discovered, or you can register custom container paths.
3. If your music lives on an SMB/CIFS or NFS NAS, expand the **NAS & Docker Volume Helper** section to either mount the share directly or generate a ready-to-use `docker-compose.yml` volume block.

---

## 2. Navigating the Electronic Program Guide (`Guide`)

The **Guide** tab is the default landing page and displays what is currently broadcasting across all enabled stations from `-30m` in the past to `+3.5h` in the future.

- **Tuning In**: Click any station's left-hand channel header (or click the currently playing track card) to tune into the live broadcast.
- **Sticky Track Titles**: As the red `NOW` playhead advances, track titles stay pinned to the left edge of the visible window so you can always read what is playing without scrolling back.
- **Click-to-Play Any Track (Time-Shifting)**:
  - See an upcoming song or a track that played 20 minutes ago? Click directly on its card in the EPG grid to start playing that track immediately from `0:00`.
  - While time-shifted, your player badge displays your offset (e.g., `+14:20` or `-08:15`). Click the **Go Live** button at any time to snap back to the real-time broadcast.
- **Quick Station Edit**: Hover or look beneath any station's name in the left column of the EPG and click **Edit** to jump directly to that station's rules in the **Curation** view.

---

## 3. Full-Screen Now Playing & Car / Bluetooth Controls (`Now Playing`)

Click **Now Playing** (to the left of **Guide** in the top navigation bar) for a full-screen listening view featuring:

- Large album artwork with ambient background glow.
- Interactive track scrub bar, live/offset indicator, and **Go Live** button.
- Dedicated transport controls for **Previous/Next Station**, **Previous/Next Track**, **Play/Pause**, and **Volume/Mute**.
- **Adjacent Stations Strip**: Semi-transparent cards showing what is currently playing on the previous and next channels so you can channel-surf with a single click.

### Keyboard Shortcuts & Car Bluetooth Controls
Even with shortcut badges hidden for a clean visual aesthetic, full keyboard and hardware media controls remain active everywhere in the app:

| Input / Control | Action |
| :--- | :--- |
| `Space` or `MediaPlayPause` | Play / Pause current station |
| `↑` / `↓` or `[` / `]` | Tune to Previous / Next Station |
| `←` / `→` | Skip to Previous / Next Track (`0:00` time-shift) |
| `M` | Toggle Mute |
| `L` | Return to **LIVE** broadcast (`offset = 0`) |
| **Car Steering Wheel / Bluetooth Prev/Next** | Switches to **Previous / Next Station** (via `MediaSession` API) |

> **Car / iPhone Safari Tip:** When streaming Radiarr from Safari on iOS over Bluetooth or CarPlay, pressing the **Next Track** or **Previous Track** buttons on your car steering wheel or head unit invokes the registered `MediaSession` handlers, tuning you up or down to the next or previous radio station just like a real car radio preset button.

---

## 4. Curating Stations, Crossfades & Dayparting (`Curation`)

Open the **Curation** tab to create, reorder, or customize your radio channels.

### Starter Station Suggestions
At the bottom of the Curation page, Radiarr analyzes your scanned libraries and presents up to **16 one-click Starter Suggestions**:
- **Up to 8 Artist Album Channels** first, ranked by the artists with the most media in your library (configured in **Album Shuffle** mode with crossfade **OFF**).
- **Up to 8 Era & Genre Shuffle Channels** next (configured in **Track Shuffle** mode with a **5s Crossfade** **ON**).
- As you add stations from the list, new suggestions automatically rotate in to replace them.

### Drag-and-Drop Channel Reordering
Grab the drag handle (`⋮⋮`) on the left side of any station row in **Your Stations** and drag it up or down. Radiarr automatically re-numbers channels (`CH 01`, `CH 02`, ...) and updates the EPG order immediately.

### Playback Modes & Gapless vs. Crossfade Transitions
Inside a station's **Edit & Station Rules** panel:
- **Play Mode**:
  - **Straight (In Order)**: Plays albums and tracks in chronological/disc order.
  - **Album Shuffle**: Shuffles whole albums, playing each album from track 1 to the end without interruption.
  - **Track Shuffle**: Shuffles individual tracks across all matching rules, avoiding back-to-back tracks by the same artist.
- **Gapless Dual-Deck Playback**: When **Crossfade** is turned **OFF** (the default for Straight and Album Shuffle stations), Radiarr preloads the upcoming track onto a secondary `<audio>` deck 25 seconds before the current track ends and switches decks at `0:00` with zero seek clipping or network delay.
- **Crossfade Between Songs**: Located inside the **Transitions & Dayparting** section. Toggle **Crossfade** **ON** (the default for era/genre Track Shuffle stations) and choose a fade length (`2s`, `3s`, `5s`, or `8s`) for smooth radio-style overlaps.

### 24-Hour Dayparting
Enable **24-Hour Dayparting** on any station to change its musical rules throughout the day (for example, *06:00 Morning Coffee*, *12:00 Midday Indie*, *22:00 Late Night Ambient*). Each daypart slot can override genres, eras, libraries, and crossfade settings.

---

## 5. Appearance & Backups (`Settings`)

- **Appearance (`Settings → Appearance`)**: Switch between **Light**, **Dark**, and **System** themes, and configure default station behavior and automatic library rescan intervals.
- **Backup & Restore (`Settings → Backup & Restore`)**:
  - **Station & Settings Config (`.json`)**: Lightweight export of all stations, channel order, dayparts, and Plex/NAS settings.
  - **Full Portable Archive (`.json`)**: Includes your entire scanned track database alongside your stations so you can migrate Radiarr to a new machine and start listening before re-scanning.
  - **Scheduled Auto-Backups**: Configure automated snapshots with custom intervals (`minutes`, `hours`, `days`) and maximum retention pruning.

---

## 6. Standalone Desktop App (`Windows, macOS, Linux`)

Radiarr is available as a standalone desktop application with zero container or Docker setup required:

- **System Tray & Background Persistence**:
  - Closing the desktop window minimizes Radiarr to your system tray (Windows taskbar or macOS menu bar) instead of terminating playback.
  - Your continuous virtual stations continue streaming in the background without burning high CPU or GPU resources.
  - Right-click the tray icon to quickly copy the local web stream URL, rescan libraries, reopen the window, or quit the application.
- **Native OS Folder Chooser**:
  - Under **Settings → Libraries → Local Folders**, clicking **Browse...** opens your native Windows File Explorer, macOS Finder, or Linux file chooser dialog to select music folders directly from your local disks or external USB drives.
- **Multi-Device LAN Streaming**:
  - The desktop app runs an embedded server on your PC or Mac. Other devices on your local network (smartphones, tablets, car head units, or IPTV receivers) can tune into `http://<YOUR-PC-IP>:3000` to stream your live radio channels.

