// A fictional music library for the browser demo. Every artist, album and song name is invented.
// The catalogue is generated deterministically, so every visitor sees the same library.

export interface DemoAlbum {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  colors: [string, string];
}

export interface DemoTrack {
  id: string;
  albumId: string;
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  year: number;
  genre: string;
  durationMs: number;
}

const ALBUMS: Omit<DemoAlbum, 'id'>[] = [
  { artist: 'Brass Meridian', title: 'Uptown Arithmetic', year: 1962, genre: 'Jazz', colors: ['#1d3557', '#e9c46a'] },
  { artist: 'Brass Meridian', title: 'After the Matinee', year: 1965, genre: 'Jazz', colors: ['#3d405b', '#f2cc8f'] },
  { artist: 'Marlowe & The Lanterns', title: 'Last Train to Evermore', year: 1968, genre: 'Psychedelic Rock', colors: ['#f94144', '#f9c74f'] },
  { artist: 'Marlowe & The Lanterns', title: 'Paper Kingdoms', year: 1971, genre: 'Psychedelic Rock', colors: ['#43aa8b', '#577590'] },
  { artist: 'Solar Drift', title: 'Golden Hour', year: 1976, genre: 'Soft Rock', colors: ['#ffcf5c', '#c8553d'] },
  { artist: 'Solar Drift', title: 'Velvet Tide', year: 1979, genre: 'Soft Rock', colors: ['#7b2d8e', '#f08a5d'] },
  { artist: 'The Harbourline', title: 'Coastal Roads', year: 1974, genre: 'Folk Rock', colors: ['#2a9d8f', '#e76f51'] },
  { artist: 'The Midnight Echo', title: 'Neon Horizon', year: 1984, genre: 'Synthwave', colors: ['#ff2e88', '#2b1055'] },
  { artist: 'The Midnight Echo', title: 'Starlight Velocity', year: 1987, genre: 'Synthwave', colors: ['#00d4ff', '#3a0ca3'] },
  { artist: 'Cassette Hearts', title: 'Friday Night Static', year: 1989, genre: 'New Wave', colors: ['#ff70a6', '#70d6ff'] },
  { artist: 'Cassette Hearts', title: 'Pastel Machines', year: 1983, genre: 'New Wave', colors: ['#ffd670', '#e980fc'] },
  { artist: 'Voltage Saints', title: 'Concrete Sunrise', year: 1993, genre: 'Alternative Rock', colors: ['#6a040f', '#f48c06'] },
  { artist: 'Voltage Saints', title: 'Wire & Bone', year: 1996, genre: 'Alternative Rock', colors: ['#343a40', '#adb5bd'] },
  { artist: 'Northern Signal', title: 'Subzero', year: 1998, genre: 'Electronic', colors: ['#a8e6ff', '#0b3954'] },
  { artist: 'Lowland Choir', title: 'Basement Hymns', year: 1995, genre: 'Indie Rock', colors: ['#606c38', '#fefae0'] },
  { artist: 'Hawthorne Pines', title: 'Autumn Letters', year: 2004, genre: 'Indie Rock', colors: ['#e07a3f', '#3d2c1e'] },
  { artist: 'Hawthorne Pines', title: 'Static & Skylines', year: 2006, genre: 'Indie Rock', colors: ['#6c8ea4', '#1b2a38'] },
  { artist: 'Amber Freeway', title: 'Overpass Summer', year: 2008, genre: 'Pop Punk', colors: ['#ffb703', '#023047'] },
  { artist: 'Ivory Circuit', title: 'Blue Hour Sessions', year: 2011, genre: 'Downtempo', colors: ['#264653', '#2a9d8f'] },
  { artist: 'Juniper Vale', title: 'Small Hours', year: 2015, genre: 'Folk', colors: ['#84a98c', '#2f3e46'] },
  { artist: 'Juniper Vale', title: 'Riverlight', year: 2019, genre: 'Folk', colors: ['#cad2c5', '#52796f'] },
  { artist: 'Glass Avenue', title: 'Afterglow District', year: 2017, genre: 'Synthwave', colors: ['#8338ec', '#ff006e'] },
  { artist: 'Copper Satellite', title: 'Long Way Down the Dial', year: 2021, genre: 'Indie Rock', colors: ['#bc6c25', '#283618'] },
  { artist: 'Northern Signal', title: 'Polar Night Transmissions', year: 2023, genre: 'Electronic', colors: ['#4361ee', '#4cc9f0'] },
];

const WORDS_A = [
  'Sunset', 'Electric', 'Paper', 'Glass', 'Midnight', 'Silver', 'Golden', 'Hollow', 'Velvet', 'Northern',
  'Quiet', 'Neon', 'Broken', 'Summer', 'Winter', 'Distant', 'Crimson', 'Lonely', 'Burning', 'Fading',
  'Restless', 'Borrowed', 'Open', 'Painted', 'Wandering', 'Secret', 'Little', 'Endless', 'Faraway',
];
const WORDS_B = [
  'Drive', 'Rain', 'Satellites', 'Harbor', 'Runner', 'Tide', 'Hour', 'Signal', 'Letters', 'Skyline',
  'Avenue', 'Machine', 'Lanterns', 'Radio', 'Highway', 'Garden', 'Echoes', 'Parade', 'Telegraph', 'Horizon',
  'Weather', 'Carousel', 'Postcards', 'Static', 'Motel', 'Orchard', 'Daydream', 'Lighthouse', 'Freeway', 'Sparks',
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCatalog(): { albums: DemoAlbum[]; tracks: DemoTrack[] } {
  const rand = mulberry32(20261115);
  const used = new Set<string>();
  const title = () => {
    for (;;) {
      const t = `${WORDS_A[Math.floor(rand() * WORDS_A.length)]} ${WORDS_B[Math.floor(rand() * WORDS_B.length)]}`;
      if (!used.has(t)) {
        used.add(t);
        return t;
      }
    }
  };

  const albums: DemoAlbum[] = [];
  const tracks: DemoTrack[] = [];
  ALBUMS.forEach((a, ai) => {
    const albumId = `demo-al-${String(ai + 1).padStart(2, '0')}`;
    albums.push({ ...a, id: albumId });
    const count = 5 + Math.floor(rand() * 4);
    for (let n = 1; n <= count; n++) {
      tracks.push({
        id: `demo-tr-${String(ai + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`,
        albumId,
        title: title(),
        artist: a.artist,
        album: a.title,
        trackNumber: n,
        year: a.year,
        genre: a.genre,
        durationMs: Math.round((150 + rand() * 150) * 1000),
      });
    }
  });
  return { albums, tracks };
}

/** Starter stations shown to every new visitor. */
export const DEMO_STATIONS: {
  name: string;
  playMode: 'shuffle' | 'album_shuffle' | 'straight';
  rules: Record<string, unknown>;
  crossfadeSeconds?: number;
}[] = [
  { name: 'All Library Shuffle', playMode: 'shuffle', rules: {}, crossfadeSeconds: 3 },
  { name: '60s & 70s Gold', playMode: 'shuffle', rules: { yearMin: 1960, yearMax: 1979 }, crossfadeSeconds: 5 },
  { name: '80s Synth & New Wave', playMode: 'shuffle', rules: { genres: ['Synthwave', 'New Wave'] }, crossfadeSeconds: 3 },
  { name: '90s Alternative', playMode: 'shuffle', rules: { yearMin: 1990, yearMax: 1999 }, crossfadeSeconds: 3 },
  { name: 'Indie & Folk Coffeehouse', playMode: 'shuffle', rules: { genres: ['Indie Rock', 'Folk', 'Folk Rock'] }, crossfadeSeconds: 5 },
  { name: 'Late Night Downtempo', playMode: 'shuffle', rules: { genres: ['Downtempo', 'Electronic', 'Jazz'] }, crossfadeSeconds: 8 },
  { name: 'The Midnight Echo: Discography', playMode: 'straight', rules: { artists: ['The Midnight Echo'] } },
  { name: 'Full Albums, Start to Finish', playMode: 'album_shuffle', rules: {} },
];
