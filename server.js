/* global __dirname */
const express = require('express');
const cors = require('cors');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Use the SINGLE canonical yt-dlp helpers from youtube.js extractor
// This eliminates the duplicate runYtdlp/ytdlpGetInfoAsync that existed here before.
const { ytdlpGetInfoAsync, withTimeout, createTempCookieFile } = require('./src/extractors/youtube');

// ── Auth & Queue
const authController = require('./src/controllers/auth.controller');
const { addDownloadJob } = require('./src/queue/download.queue');

// ── PERFORMANCE: Hoist btch-downloader at startup instead of lazy-requiring
// each time a fallback runs (saves ~300ms on first fallback call)
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

const PRO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "*/*",
};

// ===================== HELPERS =====================

const getYtdlpPath = () => {
  const isWindows = process.platform === 'win32';
  return path.join(__dirname, isWindows ? 'yt-dlp.exe' : 'yt-dlp');
};

const IS_VERCEL = !!process.env.VERCEL;

/** ASYNC playlist extraction */
const ytdlpGetPlaylistAsync = (url, timeoutMs = 30000) => {
  if (IS_VERCEL) {
    return Promise.reject(new Error('Playlists are not supported on serverless deployment. Use single video links.'));
  }
  return new Promise((resolve, reject) => {
    const ytdlpPath = getYtdlpPath();
    const args = ['--flat-playlist', '-J', '--no-warnings', '--no-check-certificates'];
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      args.push('--cookies', cookiesPath);
    } else {
      args.push('--cookies-from-browser', 'chrome');
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

// ===================== AUTH ENDPOINTS =====================
app.post('/api/auth/register', authController.register);
app.post('/api/auth/login', authController.login);

// ===================== QUEUE STATUS ENDPOINT =====================
const { downloadQueue } = require('./src/queue/download.queue');
app.get('/api/media/status/:jobId', async (req, res) => {
  try {
    const job = await downloadQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;
    res.json({ id: job.id, state, progress, result, failedReason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ===================== ASYNC QUEUE DOWNLOAD ENDPOINT =====================
app.post('/api/media/download/queue', async (req, res) => {
  try {
    const { url: mediaUrl, filename, ytId, itag, playlistUrl, playlistFormat, genericUrl, igCookies } = req.body;
    if (!mediaUrl && !ytId && !playlistUrl && !genericUrl) {
      return res.status(400).json({ error: 'url, ytId, playlistUrl, or genericUrl param required' });
    }
    const safeName = (filename || 'download').toString().replace(/[^a-zA-Z0-9._-]/g, '_');
    const urlToDownload = playlistUrl || (ytId ? (ytId.startsWith('http') ? ytId : `https://www.youtube.com/watch?v=${ytId}`) : null) || mediaUrl || genericUrl;
    
    let formatArg = itag;
    let needsMerge = itag && itag.includes('+');

    if (!formatArg) {
       formatArg = 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best';
    } else if (itag === 'bestaudio' || safeName.endsWith('.mp3') || safeName.endsWith('.m4a')) {
       formatArg = 'bestaudio[ext=m4a]/bestaudio';
    }

    const job = await addDownloadJob({
       url: urlToDownload,
       filename: safeName,
       formatArg,
       igCookies,
       needsMerge
    });

    res.json({ status: 'queued', jobId: job.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
        const ytdlpPath = getYtdlpPath();
        const ytUrl = videoId.startsWith('http') ? videoId : `https://www.youtube.com/watch?v=${videoId}`;

        let formatArg;
        const needsMerge = itag && itag.includes('+');

        if (needsMerge) {
          // User chose a specific video+audio combo (e.g. 137+140) — needs ffmpeg merge
          formatArg = itag;
        } else if (itag && itag !== 'bestvideo+bestaudio/best' && itag !== 'bestaudio' && itag !== 'best') {
          // Specific single-stream format ID
          formatArg = itag;
        } else if (itag === 'bestaudio' || safeName.endsWith('.mp3') || safeName.endsWith('.m4a')) {
          formatArg = 'bestaudio[ext=m4a]/bestaudio';
        } else {
          // FIX Bug 3: Force a pre-merged stream that has BOTH video+audio.
          // 'best' on modern YouTube can pick video-only DASH streams → black screen.
          // We require acodec!=none to guarantee audio is present.
          formatArg = 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best';
        }

        const isAudio = safeName.endsWith('.mp3') || safeName.endsWith('.m4a');
        res.setHeader('Content-Type', isAudio ? 'audio/mp4' : 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

        console.log(`[Download] yt-dlp: ${ytUrl} format=${formatArg} needsMerge=${needsMerge}`);

        const args = [
          '-f', formatArg,
          '--no-playlist',
          '--no-warnings',
          '--no-check-certificates'
        ];
        
        let tempFile = null;
        if (needsMerge) {
          // FIX Bug 4: Merge to temp file, then stream — yt-dlp can't merge to stdout
          tempFile = path.join(__dirname, `temp_merge_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
          args.push('--merge-output-format', 'mp4', '-o', tempFile);
        } else {
          // Single pre-merged stream → pipe directly to response (fast, no temp file)
          args.push('-o', '-');
        }

        const cookiesPath = path.join(__dirname, 'cookies.txt');
        let tempIgCookieFile = null;
        if (igCookies) {
           tempIgCookieFile = createTempCookieFile(igCookies);
           args.push('--cookies', tempIgCookieFile);
        } else if (fs.existsSync(cookiesPath)) {
           args.push('--cookies', cookiesPath);
        } else {
           args.push('--cookies-from-browser', 'chrome');
        }
        args.push(ytUrl);

        const ytProcess = spawn(ytdlpPath, args, { windowsHide: true });
        
        // Clean up temp cookie file when process finishes
        const cleanupTempFile = () => { if (tempIgCookieFile) try { fs.unlinkSync(tempIgCookieFile); } catch (e) {} };
        
        if (!needsMerge) {
          ytProcess.stdout.pipe(res);
        }
        
        ytProcess.stderr.on('data', (data) => console.log('yt-dlp stderr:', data.toString().trim()));
        
        ytProcess.on('error', (err) => {
          console.error('yt-dlp spawn error:', err.message);
          if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        
        ytProcess.on('close', (code) => {
          cleanupTempFile();
          if (needsMerge) {
            if (code === 0 && fs.existsSync(tempFile)) {
              const stat = fs.statSync(tempFile);
              res.setHeader('Content-Length', stat.size);
              const readStream = fs.createReadStream(tempFile);
              readStream.pipe(res);
              readStream.on('close', () => { try { fs.unlinkSync(tempFile); } catch (e) {} });
              readStream.on('error', () => {
                if (!res.headersSent) res.status(500).end();
                try { fs.unlinkSync(tempFile); } catch (e) {}
              });
            } else {
              if (!res.headersSent) res.status(500).json({ error: `yt-dlp merge failed (code ${code}). Ensure ffmpeg is installed.` });
              try { if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
            }
          } else {
            if (code !== 0 && !res.headersSent) res.status(500).json({ error: `yt-dlp exited with code ${code}` });
          }
        });
        
        req.on('close', () => {
          ytProcess.kill();
          // Clean up temp file if client disconnects during merge
          if (tempFile) {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
          }
        });
        return;
      }
    }

    // ─── Generic yt-dlp download ───
    if (genericUrl) {
      const ytdlpPath = getYtdlpPath();
      const isAudio = safeName.endsWith('.mp3');
      res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

      // FIX: Use pre-merged format with audio guarantee
      const args = [
        '-f', isAudio ? 'bestaudio[ext=m4a]/bestaudio' : 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best',
        '-o', '-',
        '--no-warnings', '--no-check-certificates'
      ];
      const cookiesPath = path.join(__dirname, 'cookies.txt');
      let tempIgCookieFile = null;
      if (igCookies) {
         tempIgCookieFile = createTempCookieFile(igCookies);
         args.push('--cookies', tempIgCookieFile);
      } else if (fs.existsSync(cookiesPath)) {
         args.push('--cookies', cookiesPath);
      } else {
         args.push('--cookies-from-browser', 'chrome');
      }
      args.push(genericUrl);

      const proc = spawn(ytdlpPath, args, { windowsHide: true });
      proc.stdout.pipe(res);
      proc.stderr.on('data', (d) => console.log('yt-dlp:', d.toString().trim()));
      proc.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
      proc.on('close', (code) => {
        if (tempIgCookieFile) try { fs.unlinkSync(tempIgCookieFile); } catch (e) {}
        if (code !== 0 && !res.headersSent) res.status(500).json({ error: `yt-dlp exit ${code}` });
      });
      req.on('close', () => proc.kill());
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
function handlePlaylistDownload(playlistUrl, format, safeName, req, res) {
  const ytdlpPath = getYtdlpPath();
  const isAudio = format === 'audio';

  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);

  console.log(`[Playlist Download] ${playlistUrl} format=${format}`);

  let args;
  if (isAudio) {
    // Audio: extract audio only, convert to mp3. No --merge-output-format needed.
    args = [
      '-x', '--audio-format', 'mp3',
      '-f', 'bestaudio',
      '-o', '-',
      '--no-warnings', '--no-check-certificates',
      '--yes-playlist'
    ];
  } else {
    // Video: use best pre-merged with audio, avoid merge requirement
    args = [
      '-f', 'best[ext=mp4][acodec!=none]/best[acodec!=none]/best',
      '-o', '-',
      '--no-warnings', '--no-check-certificates',
      '--yes-playlist'
    ];
  }

  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
     args.push('--cookies', cookiesPath);
  } else {
     args.push('--cookies-from-browser', 'chrome');
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
  });
}

// Export for Vercel serverless functions
module.exports = app;
