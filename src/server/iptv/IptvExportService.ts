import { spawn } from 'node:child_process';
import type { Request, Response } from 'express';
import { TRANSCODE_BITRATE_KBPS } from '../config.ts';
import { scheduleEngine } from '../engine/ScheduleEngine.ts';
import { resolvePlexStreamUrl } from '../sources/PlexService.ts';
import { getTrackByIdFromDb } from '../audio/StreamService.ts';
import { isDirectPlayExtension, transcodeCache } from '../audio/TranscodeCache.ts';

function getBaseUrl(req: Request): string {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto =
    typeof protoHeader === 'string' && protoHeader.trim() !== ''
      ? protoHeader.split(',')[0].trim()
      : req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeM3uAttr(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/"/g, "'").replace(/\r?\n/g, ' ').trim();
}

/**
 * Formats a timestamp (ms) into XMLTV date format: YYYYMMDDHHmmss +0000 (UTC)
 */
function formatXmltvTimestamp(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const min = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss} +0000`;
}

/**
 * Generates an M3U8 IPTV playlist containing all enabled stations.
 */
export function serveM3uPlaylist(req: Request, res: Response): void {
  const baseUrl = getBaseUrl(req);
  const xmltvUrl = `${baseUrl}/api/xmltv.xml`;
  const stations = scheduleEngine.listStations().filter((s) => s.enabled);

  const lines: string[] = [
    `#EXTM3U url-tvg="${xmltvUrl}" x-tvg-url="${xmltvUrl}"`,
  ];

  for (const st of stations) {
    const safeName = escapeM3uAttr(st.name);
    const channelId = escapeM3uAttr(st.id);
    const chNum = st.channelNumber;

    // Prefer custom station thumbnail via clean HTTP endpoint, else current track artwork
    let logoUrl = '';
    if (st.thumbnailUrl) {
      logoUrl =
        st.thumbnailUrl.startsWith('http://') || st.thumbnailUrl.startsWith('https://')
          ? st.thumbnailUrl
          : `${baseUrl}/api/stations/${encodeURIComponent(st.id)}/thumbnail`;
    } else {
      const tune = scheduleEngine.tuneStation(st.id, 0, Date.now());
      const logoPath = tune?.nowPlaying?.track?.artUrl || '';
      logoUrl = logoPath
        ? logoPath.startsWith('http')
          ? logoPath
          : `${baseUrl}${logoPath}`
        : '';
    }

    const logoAttr = logoUrl ? ` tvg-logo="${escapeM3uAttr(logoUrl)}"` : '';
    lines.push(
      `#EXTINF:-1 tvg-id="${channelId}" tvg-chno="${chNum}" tvg-name="${safeName}"${logoAttr} group-title="Radiarr",${st.name.replace(/\r?\n/g, ' ')}`
    );
    lines.push(`${baseUrl}/api/stations/${encodeURIComponent(st.id)}/stream.mp3`);
  }

  const content = lines.join('\n') + '\n';

  if (req.query.download === '1' || req.query.download === 'true') {
    res.setHeader('Content-Disposition', 'attachment; filename="radiarr-channels.m3u"');
  } else {
    res.setHeader('Content-Disposition', 'inline; filename="radiarr-channels.m3u"');
  }
  res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
  res.send(content);
}

/**
 * Generates an XMLTV EPG document across all enabled stations.
 * Default window: 1 hour in the past to 24 hours in the future.
 */
export function serveXmltvEpg(req: Request, res: Response): void {
  const baseUrl = getBaseUrl(req);
  const nowMs = Date.now();
  const hoursAhead = Math.min(
    72,
    Math.max(2, Number(req.query.hours) || 24)
  );
  const fromMs = nowMs - 60 * 60 * 1000;
  const toMs = nowMs + hoursAhead * 60 * 60 * 1000;

  const epg = scheduleEngine.getEpgWindow(fromMs, toMs, nowMs);

  const xml: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE tv SYSTEM "xmltv.dtd">`,
    `<tv source-info-name="Radiarr" generator-info-name="Radiarr" generator-info-url="${escapeXml(baseUrl)}">`,
  ];

  // 1. Channel definitions
  for (const item of epg.stations) {
    const st = item.station;
    let iconUrl = '';
    if (st.thumbnailUrl) {
      iconUrl =
        st.thumbnailUrl.startsWith('http://') || st.thumbnailUrl.startsWith('https://')
          ? st.thumbnailUrl
          : `${baseUrl}/api/stations/${encodeURIComponent(st.id)}/thumbnail`;
    } else {
      const firstArt = item.slots.find((s) => s.track.artUrl)?.track.artUrl;
      iconUrl = firstArt
        ? firstArt.startsWith('http')
          ? firstArt
          : `${baseUrl}${firstArt}`
        : '';
    }

    xml.push(`  <channel id="${escapeXml(st.id)}">`);
    xml.push(`    <display-name>${escapeXml(st.name)}</display-name>`);
    xml.push(`    <display-name>${st.channelNumber} ${escapeXml(st.name)}</display-name>`);
    xml.push(`    <display-name>${st.channelNumber}</display-name>`);
    if (iconUrl) {
      xml.push(`    <icon src="${escapeXml(iconUrl)}" />`);
    }
    xml.push(`  </channel>`);
  }

  // 2. Programme slots
  for (const item of epg.stations) {
    const st = item.station;
    for (const slot of item.slots) {
      const startStr = formatXmltvTimestamp(slot.startMs);
      const stopStr = formatXmltvTimestamp(slot.endMs);
      const t = slot.track;

      const subTitleParts = [t.artist, t.album].filter(Boolean);
      if (t.year) subTitleParts.push(`(${t.year})`);
      const subTitle = subTitleParts.join(' • ');

      const descParts = [
        `Artist: ${t.artist}`,
        `Album: ${t.album}`,
      ];
      if (t.year) descParts.push(`Year: ${t.year}`);
      if (t.genre) descParts.push(`Genre: ${t.genre}`);
      descParts.push(`Station: CH ${st.channelNumber} ${st.name}`);

      const artUrl = t.artUrl
        ? t.artUrl.startsWith('http')
          ? t.artUrl
          : `${baseUrl}${t.artUrl}`
        : '';

      xml.push(
        `  <programme start="${startStr}" stop="${stopStr}" channel="${escapeXml(st.id)}">`
      );
      xml.push(`    <title lang="en">${escapeXml(t.title)}</title>`);
      if (subTitle) {
        xml.push(`    <sub-title lang="en">${escapeXml(subTitle)}</sub-title>`);
      }
      xml.push(`    <desc lang="en">${escapeXml(descParts.join(' | '))}</desc>`);
      if (t.genre) {
        xml.push(`    <category lang="en">${escapeXml(t.genre)}</category>`);
      }
      xml.push(`    <category lang="en">Music</category>`);
      if (t.year) {
        xml.push(`    <date>${t.year}</date>`);
      }
      if (artUrl) {
        xml.push(`    <icon src="${escapeXml(artUrl)}" />`);
      }
      xml.push(`  </programme>`);
    }
  }

  xml.push(`</tv>`);
  const content = xml.join('\n') + '\n';

  if (req.query.download === '1' || req.query.download === 'true') {
    res.setHeader('Content-Disposition', 'attachment; filename="radiarr-epg.xml"');
  } else {
    res.setHeader('Content-Disposition', 'inline; filename="radiarr-epg.xml"');
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(content);
}

/**
 * Streams a continuous live MP3 broadcast for a station so external M3U players
 * (VLC, Tivimate, Plex/Jellyfin Live TV, Apple Music, etc.) can tune in seamlessly.
 */
export async function streamLiveStationMp3(
  req: Request,
  res: Response
): Promise<void> {
  const { id } = req.params;
  const station = scheduleEngine.getStationById(id);

  if (!station) {
    res.status(404).json({ error: `Station "${id}" not found.` });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('icy-name', station.name);
  res.setHeader('icy-br', String(TRANSCODE_BITRATE_KBPS));

  let closed = false;
  let activeFfmpeg: ReturnType<typeof spawn> | null = null;

  const cleanup = () => {
    closed = true;
    if (activeFfmpeg) {
      try {
        activeFfmpeg.kill('SIGKILL');
      } catch {
        // ignore
      }
      activeFfmpeg = null;
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  while (!closed && !res.writableEnded) {
    const tune = scheduleEngine.tuneStation(id, 0, Date.now());
    if (!tune || tune.empty || !tune.nowPlaying) {
      break;
    }

    const { track, positionMs } = tune.nowPlaying;
    const dbTrack = getTrackByIdFromDb(track.id);
    if (!dbTrack) {
      break;
    }

    let inputSource = dbTrack.filePath;
    if (!isDirectPlayExtension(dbTrack.ext)) {
      const cached = transcodeCache.getCachedPathIfReady(dbTrack.id);
      if (cached) {
        inputSource = cached;
      } else if (dbTrack.filePath.startsWith('plex://')) {
        inputSource = resolvePlexStreamUrl(dbTrack.filePath) || '';
      }
    } else if (dbTrack.filePath.startsWith('plex://')) {
      inputSource = resolvePlexStreamUrl(dbTrack.filePath) || '';
    }

    if (!inputSource) {
      break;
    }

    const seekSec = Math.max(0, positionMs / 1000);
    const remainingSec = Math.max(1, (track.durationMs - positionMs) / 1000);

    await new Promise<void>((resolve) => {
      if (closed) {
        resolve();
        return;
      }

      const args = [
        '-v',
        'error',
        '-re',
        '-ss',
        seekSec.toFixed(2),
        '-t',
        remainingSec.toFixed(2),
        '-i',
        inputSource,
        '-vn',
        '-c:a',
        'libmp3lame',
        '-b:a',
        `${TRANSCODE_BITRATE_KBPS}k`,
        '-ar',
        '44100',
        '-ac',
        '2',
        '-f',
        'mp3',
        'pipe:1',
      ];

      const ff = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      activeFfmpeg = ff;

      ff.stdout.on('data', (chunk: Buffer) => {
        if (!closed && !res.writableEnded) {
          res.write(chunk);
        }
      });

      ff.on('close', () => {
        activeFfmpeg = null;
        resolve();
      });

      ff.on('error', () => {
        activeFfmpeg = null;
        resolve();
      });
    });
  }

  if (!res.writableEnded) {
    res.end();
  }
}
