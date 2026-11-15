# Radiarr Mobile Porting & Starter Guide

This document provides everything needed to launch **Radiarr Mobile** as a dedicated Expo / React Native project in Google AI Studio, connecting directly to Plex with on-device scheduling and native background audio.

---

## 1. Quick-Start Prompt for New AI Studio Project

When you create the new project in Google AI Studio, use this prompt:

```text
Build Radiarr Mobile: A standalone native music radio app built with Expo (React Native) and TypeScript.
It connects directly to a user's Plex Media Server (or local device audio), runs Radiarr's deterministic radio scheduling engine on-device, and uses react-native-track-player for rock-solid iOS and Android lock-screen background playback, car Bluetooth integration, and an EPG guide.
```

---

## 2. Portable Shared Files to Copy Over

These files from the Radiarr web repository are pure TypeScript with zero Node-specific server dependencies. They can be copied directly into the new project's `src/engine/` folder:

1. **`src/server/engine/ScheduleEngine.ts`** – Deterministic radio timeline generator
2. **`src/server/engine/CycleGenerator.ts`** – Continuous playlist cycler & shuffle bag
3. **`src/server/engine/RuleMatcher.ts`** – Tag, genre, era, dayparting, and BPM filtering logic
4. **`src/server/engine/ScheduleResolver.ts`** – Point-in-time slot and overlap resolver
5. **`src/server/engine/prng.ts`** – Seeded pseudo-random number generator
6. **`src/shared/stationVisuals.ts`** – Station color schemes, channel numbering, and badge styling
7. **`src/shared/metadataNormalizer.ts`** – Dayparting hour calculations and metadata cleanup
8. **`src/client/utils/volumeLeveler.ts`** – Mastering era loudness normalization math
9. **`src/server/sources/PlexService.ts`** – Plex REST client and track parsing utilities

---

## 3. Recommended Mobile Stack for the New Project

```json
{
  "dependencies": {
    "expo": "~52.0.0",
    "react-native": "0.76.0",
    "react-native-track-player": "^4.1.1",
    "expo-sqlite": "~15.0.0",
    "lucide-react-native": "^0.475.0",
    "react-native-reanimated": "~3.16.0",
    "react-native-gesture-handler": "~2.20.0",
    "react-native-safe-area-context": "4.12.0"
  }
}
```

---

## 4. Testing with Expo Go (Physical Phone)

1. Download **Expo Go** from the iOS App Store or Google Play Store (free).
2. Start the dev server in the new AI Studio project.
3. Scan the terminal / Metro QR code with your phone camera.
4. The app opens immediately on your phone with live reload and background audio enabled.
