// Generated cover art for the fictional demo library: a gradient, a simple pattern, and the album name.

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function albumCoverSvg(title: string, artist: string, colors: [string, string]): string {
  const h = hash(title + artist);
  const style = h % 3;
  let pattern = '';
  if (style === 0) {
    for (let i = 0; i < 6; i++) {
      pattern += `<circle cx="300" cy="${330 + (h % 60)}" r="${60 + i * 42}" fill="none" stroke="#fff" stroke-opacity="${0.22 - i * 0.03}" stroke-width="10"/>`;
    }
  } else if (style === 1) {
    for (let i = 0; i < 9; i++) {
      pattern += `<rect x="-100" y="${i * 80 - 40}" width="900" height="26" fill="#fff" fill-opacity="${0.04 + (i % 3) * 0.04}" transform="rotate(${-18 + (h % 36)} 300 300)"/>`;
    }
  } else {
    pattern += `<circle cx="${180 + (h % 240)}" cy="250" r="150" fill="#fff" fill-opacity="0.18"/>`;
    pattern += `<rect x="0" y="380" width="600" height="220" fill="#000" fill-opacity="0.18"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>${pattern}
  <text x="36" y="520" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" fill="#fff">${esc(title)}</text>
  <text x="36" y="562" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#fff" fill-opacity="0.85">${esc(artist)}</text>
</svg>`;
}

export function artistPhotoSvg(artist: string, colors: [string, string]): string {
  const initials = artist
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && w.toLowerCase() !== 'the')
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs><radialGradient id="g" cx="0.3" cy="0.3" r="1"><stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></radialGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <text x="300" y="350" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="180" font-weight="700" fill="#fff" fill-opacity="0.9">${esc(initials)}</text>
</svg>`;
}
