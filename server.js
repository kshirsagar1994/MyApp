/* global __dirname */
require('dotenv').config({ override: true });
const express = require('express');
const cors = require('cors');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ── Use the SINGLE canonical yt-dlp helpers from youtube.js extractor
// This eliminates the duplicate runYtdlp/ytdlpGetInfoAsync that existed here before.
const { createTempCookieFile, ensureYtdlp } = require('./src/extractors/youtube');

// ── Auth
// Auth controller removed

// ── PERFORMANCE: Hoist btch-downloader at startup instead of lazy-requiring
// each time a fallback runs (saves ~300ms on first fallback call)
// Removed unused btch-downloader require

const PRO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "*/*",
};

// ===================== HELPERS =====================

const getYtdlpPath = async () => {
  return await ensureYtdlp();
};

let _ffmpegChecked = null;
const isFfmpegAvailable = () => {
  if (_ffmpegChecked !== null) return _ffmpegChecked;
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    _ffmpegChecked = true;
  } catch {
    _ffmpegChecked = false;
  }
  return _ffmpegChecked;
};

const IS_VERCEL = !!process.env.VERCEL;

/** ASYNC playlist extraction */
const ytdlpGetPlaylistAsync = async (url, timeoutMs = 30000) => {
  if (IS_VERCEL) {
    return Promise.reject(new Error('Playlists are not supported on serverless deployment. Use single video links.'));
  }
  const ytdlpPath = await getYtdlpPath();
  return new Promise((resolve, reject) => {
    const args = ['--flat-playlist', '-J', '--no-warnings', '--no-check-certificates', '--js-runtimes', 'node'];
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    }
    args.push(url);
    const proc = spawn(ytdlpPath, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`Playlist extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`));
      }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error('Failed to parse playlist data')); }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
};

function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── PERFORMANCE: Gzip compression — reduces JSON response size by ~70%
// Critical for mobile networks where /api/media/analyze returns 5-15KB
app.use('/api/media/serve', express.static(path.join(__dirname, 'temp_downloads')));

try {
  const compression = require('compression');
  app.use(compression());
} catch {
  // compression not installed — continue without it
}

// ── MODULAR CONTROLLER: Uses src/controllers and src/extractors for clean separation
const { analyzeUrl: modularAnalyze } = require('./src/controllers/media.controller');

app.get('/', (_req, res) => {
  res.json({ status: 'alive', message: 'Backend is running', supportedPlatforms: ['youtube', 'instagram', 'facebook', 'linkedin', 'snapchat', 'tiktok', 'twitter', 'pinterest', 'threads'] });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Backend is healthy', timestamp: new Date().toISOString() });
});

// ===================== AUTH ENDPOINTS REMOVED =====================



// ===================== ANALYZE ENDPOINT =====================
app.post('/api/media/analyze', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ status: 'error', message: 'URL is required' });

  // ── PERFORMANCE: Fast URL validation — reject garbage before spawning yt-dlp
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ status: 'error', message: 'Invalid URL. Only http/https links are supported.' });
    }
  } catch {
    return res.status(400).json({ status: 'error', message: 'Invalid URL format.' });
  }

  // YouTube playlists need special handling via server-level yt-dlp helpers
  // (shared with the download endpoint), so they stay in server.js
  if ((url.includes('youtube.com') || url.includes('youtu.be')) &&
      url.includes('list=') && (url.includes('/playlist') || url.includes('&list='))) {
    try {
      console.log(`\n[Analyze] Platform: youtube (playlist) | URL: ${url}`);
      return await handleYouTubePlaylist(url, res);
    } catch (err) {
      console.error('Playlist Error:', err.message);
      return res.status(500).json({ status: 'error', message: err.message });
    }
  }

  // All other URLs → modular controller (YouTube single, IG, FB, Snap, LinkedIn)
  console.log(`\n[Analyze] URL: ${url}`);
  return modularAnalyze(req, res);
});


// ===================== YOUTUBE PLAYLIST (server-level for yt-dlp helpers) =====================
async function handleYouTubePlaylist(url, res) {
  try {
    console.log('[YouTube] Extracting playlist...');
    const playlistInfo = await ytdlpGetPlaylistAsync(url, 30000);

    const playlistTitle = playlistInfo.title || 'YouTube Playlist';
    const entries = playlistInfo.entries || [];
    if (entries.length === 0) throw new Error('Playlist is empty or private.');

    const options = [];

    options.push({
      quality: `📥 Entire Playlist — Video (${entries.length} videos)`,
      size: 'Auto', format: 'MP4', url: '',
      playlistUrl: url, isPlaylist: true, playlistFormat: 'video', useProxy: true,
    });

    options.push({
      quality: `🎵 Entire Playlist — Audio (${entries.length} tracks)`,
      size: 'Auto', format: 'MP3', url: '',
      playlistUrl: url, isPlaylist: true, playlistFormat: 'audio', isAudio: true, useProxy: true,
    });

    const maxEntries = Math.min(entries.length, 50);
    for (let i = 0; i < maxEntries; i++) {
      const entry = entries[i];
      options.push({
        quality: `${i + 1}. ${(entry.title || `Video ${i + 1}`).substring(0, 60)}`,
        size: entry.duration ? formatDuration(entry.duration) : 'Auto',
        format: 'MP4', url: '',
        ytId: entry.id || entry.url,
        itag: 'best',
        thumbnail: entry.thumbnails?.[0]?.url || '',
        useProxy: true,
      });
    }

    return res.json({
      status: 'success',
      data: {
        type: 'playlist',
        title: `${playlistTitle} (${entries.length} videos)`,
        thumbnail: entries[0]?.thumbnails?.[0]?.url || '',
        options,
      },
    });
  } catch (err) {
    console.error('[YouTube Playlist] Error:', err.message);
    throw new Error('Playlist extraction failed: ' + err.message);
  }
}


// ===================== LEGACY DOWNLOAD / PROXY ENDPOINT =====================
app.get('/api/media/download', async (req, res) => {
  const { url: mediaUrl, filename, ytId, itag, playlistUrl, playlistFormat, genericUrl, igCookies } = req.query;
  if (!mediaUrl && !ytId && !playlistUrl && !genericUrl) {
    return res.status(400).json({ error: 'url, ytId, playlistUrl, or genericUrl param required' });
  }

  const safeName = (filename || 'download').toString().replace(/[^a-zA-Z0-9._-]/g, '_');

  try {
    // ─── YouTube Playlist download ───
    if (playlistUrl) {
      return handlePlaylistDownload(playlistUrl, playlistFormat, safeName, req, res);
    }

    // ─── YouTube single video via yt-dlp ───
    if (ytId || (mediaUrl && (mediaUrl.includes('googlevideo.com') || mediaUrl.includes('youtube.com')))) {
      const videoId = ytId;
      if (videoId) {
        const ytdlpPath = await getYtdlpPath();
        const ytUrl = videoId.startsWith('http') ? videoId : `https://www.youtube.com/watch?v=${videoId}`;

        let formatArg;
        let needsMerge = itag && itag.includes('+');

        // On environments without ffmpeg (e.g. Vercel serverless), merging video+audio fails
        if (needsMerge && !isFfmpegAvailable()) {
          console.log('[Download] ffmpeg not available, falling back to best pre-merged stream');
          needsMerge = false;
        }

        const isAudio = safeName.endsWith('.mp3') || safeName.endsWith('.m4a');
        const ext = isAudio ? 'm4a' : 'mp4';

        if (needsMerge) {
          formatArg = `${itag}/bestvideo+bestaudio/best`;
        } else if (itag && itag !== 'bestvideo+bestaudio/best' && itag !== 'bestaudio' && itag !== 'best' && !itag.includes('+')) {
          formatArg = isAudio ? `${itag}/bestaudio[ext=m4a]/bestaudio/best` : `${itag}/best[ext=mp4][acodec!=none]/best[acodec!=none]/best`;
        } else if (itag === 'bestaudio' || isAudio) {
          formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
        } else {
          formatArg = 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best';
        }

        console.log(`[Download] yt-dlp: ${ytUrl} format=${formatArg} needsMerge=${needsMerge}`);

        const tempFile = path.join(os.tmpdir(), `temp_yt_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`);

        const args = [
          '-f', formatArg,
          '--no-playlist',
          '--no-warnings',
          '--no-check-certificates',
          '--js-runtimes', `node:${process.execPath}`,
          '-o', tempFile
        ];

        if (needsMerge) {
          args.push('--merge-output-format', 'mp4');
        }

        const cookiesPath = path.join(__dirname, 'cookies.txt');
        let tempIgCookieFile = null;
        if (igCookies) {
           tempIgCookieFile = createTempCookieFile(igCookies);
           args.push('--cookies', tempIgCookieFile);
        } else if (fs.existsSync(cookiesPath)) {
           args.push('--cookies', cookiesPath);
        }
        args.push(ytUrl);

        const ytProcess = spawn(ytdlpPath, args, { windowsHide: true });
        
        const cleanupTempFile = () => {
          if (tempIgCookieFile) try { fs.unlinkSync(tempIgCookieFile); } catch (_e) {}
        };
        
        ytProcess.stderr.on('data', (data) => console.log('yt-dlp stderr:', data.toString().trim()));
        
        ytProcess.on('error', (err) => {
          cleanupTempFile();
          console.error('yt-dlp spawn error:', err.message);
          if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        
        ytProcess.on('close', (code) => {
          cleanupTempFile();
          if (code === 0 && fs.existsSync(tempFile)) {
            const stat = fs.statSync(tempFile);
            res.setHeader('Content-Type', isAudio ? 'audio/mp4' : 'video/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
            res.setHeader('Content-Length', stat.size);
            const readStream = fs.createReadStream(tempFile);
            readStream.pipe(res);
            readStream.on('close', () => { try { fs.unlinkSync(tempFile); } catch (_e) {} });
            readStream.on('error', () => {
              if (!res.headersSent) res.status(500).end();
              try { fs.unlinkSync(tempFile); } catch (_e) {}
            });
          } else {
            console.error(`yt-dlp exited with code ${code}`);
            if (!res.headersSent) res.status(500).json({ error: `yt-dlp failed (code ${code})` });
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_e) {}
          }
        });
        
        req.on('close', () => {
          ytProcess.kill();
          if (fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch (_e) {}
          }
        });
        return;
      }
    }

    // ─── Generic yt-dlp download ───
    if (genericUrl) {
      const ytdlpPath = await getYtdlpPath();
      const isAudio = safeName.endsWith('.mp3') || safeName.endsWith('.m4a');
      res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

      let formatArg;
      let needsMerge = !isAudio && isFfmpegAvailable();

      if (needsMerge) {
        formatArg = 'bestvideo+bestaudio/best';
      } else if (isAudio) {
        formatArg = 'bestaudio[ext=m4a]/bestaudio';
      } else {
        formatArg = 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best';
      }

      console.log(`[Download] Generic yt-dlp: ${genericUrl} format=${formatArg} needsMerge=${needsMerge}`);

      const args = [
        '-f', formatArg,
        '--no-warnings',
        '--no-check-certificates',
        '--js-runtimes', 'node'
      ];

      if (genericUrl.includes('youtube.com') || genericUrl.includes('youtu.be')) {
        args.push('--extractor-args', 'youtube:player_client=android,ios,web');
      }

      let tempFile = null;
      if (needsMerge) {
        tempFile = path.join(os.tmpdir(), `temp_merge_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
        args.push('--merge-output-format', 'mp4', '-o', tempFile);
      } else {
        args.push('-o', '-');
      }

      const cookiesPath = path.join(__dirname, 'cookies.txt');
      let tempIgCookieFile = null;
      if (igCookies) {
         tempIgCookieFile = createTempCookieFile(igCookies);
         args.push('--cookies', tempIgCookieFile);
      } else if (fs.existsSync(cookiesPath)) {
         args.push('--cookies', cookiesPath);
      }
      args.push(genericUrl);

      const proc = spawn(ytdlpPath, args, { windowsHide: true });
      const cleanupTempFile = () => {
        if (tempIgCookieFile) try { fs.unlinkSync(tempIgCookieFile); } catch (_e) {}
      };

      if (!needsMerge) {
        proc.stdout.pipe(res);
      }

      proc.stderr.on('data', (d) => console.log('yt-dlp generic:', d.toString().trim()));
      proc.on('error', (err) => {
        cleanupTempFile();
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });

      proc.on('close', (code) => {
        cleanupTempFile();
        if (needsMerge) {
          if (code === 0 && tempFile && fs.existsSync(tempFile)) {
            const stat = fs.statSync(tempFile);
            res.setHeader('Content-Length', stat.size);
            const readStream = fs.createReadStream(tempFile);
            readStream.pipe(res);
            readStream.on('close', () => { try { fs.unlinkSync(tempFile); } catch (_e) {} });
            readStream.on('error', () => {
              if (!res.headersSent) res.status(500).end();
              try { fs.unlinkSync(tempFile); } catch (_e) {}
            });
          } else {
            if (!res.headersSent) res.status(500).json({ error: `yt-dlp merge failed (code ${code}).` });
            try { if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_e) {}
          }
        } else {
          if (code !== 0 && !res.headersSent) res.status(500).json({ error: `yt-dlp exit ${code}` });
        }
      });

      req.on('close', () => {
        proc.kill();
        if (tempFile) try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_e) {}
      });
      return;
    }

    // ─── Standard fetch proxy for direct URLs ───
    const headers = { ...PRO_HEADERS };
    if (mediaUrl.includes('instagram.com') || mediaUrl.includes('cdninstagram.com') || mediaUrl.includes('fbcdn.net')) {
      headers['Referer'] = 'https://www.instagram.com/';
    } else if (mediaUrl.includes('facebook.com')) {
      headers['Referer'] = 'https://www.facebook.com/';
    }

    const response = await fetch(mediaUrl, { headers, redirect: 'follow' });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const nodeStream = Readable.fromWeb(response.body);
    nodeStream.pipe(res);
    nodeStream.on('error', (err) => {
      console.error('Proxy stream error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  } catch (err) {
    console.error('Proxy download error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ===================== PLAYLIST DOWNLOAD =====================
async function handlePlaylistDownload(playlistUrl, format, safeName, req, res) {
  const ytdlpPath = await getYtdlpPath();
  const isAudio = format === 'audio';

  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

  console.log(`[Playlist Download] ${playlistUrl} format=${format}`);

  let args;
  if (format === 'audio') {
    args = [
      '-f', 'bestaudio',
      '-o', '-',
      '--no-warnings', '--no-check-certificates',
      '--js-runtimes', 'node',
      '--yes-playlist'
    ];
  } else {
    // Video: use best pre-merged with audio, avoid merge requirement
    args = [
      '-f', 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best',
      '-o', '-',
      '--no-warnings', '--no-check-certificates',
      '--js-runtimes', 'node',
      '--yes-playlist'
    ];
  }

  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
     args.push('--cookies', cookiesPath);
  }
  args.push(playlistUrl);

  const proc = spawn(ytdlpPath, args, { windowsHide: true });
  proc.stdout.pipe(res);
  proc.stderr.on('data', (d) => console.log('yt-dlp playlist:', d.toString().trim()));
  proc.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  proc.on('close', (code) => { if (code !== 0 && !res.headersSent) res.status(500).json({ error: `yt-dlp playlist exit ${code}` }); });
  req.on('close', () => proc.kill());
}

// ===================== PLAYLIST ITEMS ENDPOINT =====================
app.get('/api/media/playlist-items', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url param required' });

  try {
    const info = await ytdlpGetPlaylistAsync(url, 30000);
    const entries = (info.entries || []).map((e, i) => ({
      index: i + 1,
      id: e.id || e.url,
      title: e.title || `Video ${i + 1}`,
      duration: e.duration,
      thumbnail: e.thumbnails?.[0]?.url || '',
    }));
    res.json({ status: 'success', title: info.title, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log('Supported: YouTube (single + playlists), Instagram, Facebook, Snapchat, LinkedIn');

    // Automatically configure ADB reverse proxy for physical Android devices
    try {
      const { exec } = require('child_process');
      exec(`adb reverse tcp:${PORT} tcp:${PORT}`, (err) => {
        if (!err) {
          console.log(`[ADB] Successfully reversed port ${PORT} to connected Android device(s)`);
        }
      });
    } catch {
      // Ignore if adb is not present
    }
  });
}

// Export for Vercel serverless functions
module.exports = app;
