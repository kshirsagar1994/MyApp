const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Async yt-dlp JSON extraction — non-blocking.
 * NOTE: On Vercel serverless, yt-dlp binary cannot run. We detect this
 * and immediately reject so callers fall through to btch-downloader fallback.
 */
const IS_VERCEL = !!process.env.VERCEL;

const runYtdlp = (url, extraArgs = [], timeoutMs = 20000) => {
  if (IS_VERCEL) {
    return Promise.reject(new Error('yt-dlp unavailable in serverless environment'));
  }
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const ytdlpPath = path.resolve(__dirname, '..', '..', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
    const args = ['-j', '--no-warnings', '--no-check-certificates', ...extraArgs, url];
    const proc = spawn(ytdlpPath, args, { windowsHide: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const errMsg = stderr.trim() || `yt-dlp exited with code ${code}`;
        return reject(new Error(errMsg));
      }
      try {
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        if (lines.length === 1) {
          resolve(JSON.parse(lines[0]));
        } else {
          const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          if (entries.length === 1) resolve(entries[0]);
          else resolve({ _type: 'multi', entries });
        }
      } catch { reject(new Error('Failed to parse yt-dlp output')); }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
};

/**
 * Async yt-dlp JSON extraction with cookie fallback.
 * FIX Bug 7: Only retry on genuine auth errors. Do NOT retry on 404/403/not-found/dpapi/decrypt
 * which are not fixable by cookies and waste 20+ seconds.
 */
const ytdlpGetInfoAsync = async (url, extraArgs = [], timeoutMs = 20000) => {
  try {
    return await runYtdlp(url, extraArgs, timeoutMs);
  } catch (err) {
    const msg = err.message ? err.message.toLowerCase() : '';
    // Expand retry to include 404, 403, 401, 400, etc., as private posts often return these
    const needsAuth = msg && (
      msg.includes('login') ||
      msg.includes('cookies') ||
      msg.includes('authentication') ||
      msg.includes('private') ||
      msg.includes('empty media response') ||
      msg.includes('instagram api is not granting access') ||
      msg.includes('404') || msg.includes('not found') ||
      msg.includes('403') || msg.includes('forbidden') ||
      msg.includes('401') || msg.includes('unauthorized') ||
      msg.includes('400')
    );
    if (!needsAuth) throw err;

    // Try cookies.txt file if available (fast, no UAC prompts)
    const cookiesPath = path.resolve(__dirname, '..', '..', 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      console.log('[yt-dlp] Auth error — retrying with cookies.txt...');
      try {
        return await runYtdlp(url, ['--cookies', cookiesPath, ...extraArgs], timeoutMs);
      } catch (cookieTxtErr) {
        console.error('[yt-dlp] cookies.txt retry failed:', cookieTxtErr.message);
      }
    }
    
    // Attempt to use Chrome cookies for private profiles
    console.log('[yt-dlp] Auth error — retrying with Chrome cookies...');
    try {
      return await runYtdlp(url, ['--cookies-from-browser', 'chrome', ...extraArgs], timeoutMs + 5000);
    } catch (chromeErr) {
      console.error('[yt-dlp] Chrome cookies failed, trying Edge...');
      try {
        return await runYtdlp(url, ['--cookies-from-browser', 'edge', ...extraArgs], timeoutMs + 5000);
      } catch (edgeErr) {
        console.error('[yt-dlp] Edge cookies failed, trying Firefox...');
        try {
          return await runYtdlp(url, ['--cookies-from-browser', 'firefox', ...extraArgs], timeoutMs + 5000);
        } catch (firefoxErr) {
          console.error('[yt-dlp] Firefox cookies failed.');
          throw err;
        }
      }
    }
  }
};

/**
 * Executes a Promise with a strict timeout.
 */
const withTimeout = (promise, ms, name = 'Operation') => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms))
  ]);
};

/**
 * Extracts YouTube media metadata using async yt-dlp.
 * Falls back to btch-downloader on serverless (Vercel) where yt-dlp is unavailable.
 */
const extractYouTube = async (url) => {
  // 1. PRIMARY: yt-dlp (works on Docker/Render/local, skipped on Vercel)
  try {
    console.log('[YouTube Extractor] PRIMARY: yt-dlp extraction:', url);
    const info = await ytdlpGetInfoAsync(url, ['--no-playlist'], 20000);

    const videoId = info.id;
    const title = info.title || 'YouTube Media';
    const thumbnail = info.thumbnail || '';
    const options = [];

    const formats = info.formats || [];

    const videoFormats = formats.filter(fmt => fmt.vcodec !== 'none');
    videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

    const uniqueHeights = [...new Set(videoFormats.map(f => f.height))];

    // Audio formats for merging with video-only streams
    const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');

    // Find best m4a audio for maximum compatibility when merging
    const bestAudioM4a = audioFormats.find(f => f.ext === 'm4a') || audioFormats[0];
    const bestAudioId = bestAudioM4a ? bestAudioM4a.format_id : 'bestaudio';

    uniqueHeights.forEach((h) => {
      if (!h) return;
      const f = videoFormats.find((fmt) => fmt.height === h && fmt.acodec !== 'none' && fmt.ext === 'mp4' && fmt.vcodec?.includes('avc1')) ||
                videoFormats.find((fmt) => fmt.height === h && fmt.acodec !== 'none' && fmt.ext === 'mp4') ||
                videoFormats.find((fmt) => fmt.height === h && fmt.acodec !== 'none') || 
                videoFormats.find((fmt) => fmt.height === h && fmt.ext === 'mp4' && fmt.vcodec?.includes('avc1')) ||
                videoFormats.find((fmt) => fmt.height === h && fmt.ext === 'mp4') ||
                videoFormats.find((fmt) => fmt.height === h);
                
      if (f) {
        const label = h >= 2160 ? '4K' : h >= 1440 ? '2K' : h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : h >= 480 ? 'SD' : 'Low';
        const isMerged = f.acodec !== 'none';
        options.push({
          quality: `Video ${label} (${h}p)`,
          size: 'Auto',
          format: 'MP4',
          url: '',
          ytId: videoId,
          itag: isMerged ? f.format_id : `${f.format_id}+${bestAudioId}`,
          note: isMerged ? '' : 'HD/4K (Requires ffmpeg)',
          useProxy: true,
        });
      }
    });

    // Fallback best quality — explicitly require audio to prevent black screen
    if (options.length === 0) {
      options.push({
        quality: 'Best Available',
        size: 'Auto', format: 'MP4', url: '',
        ytId: videoId, itag: 'best', useProxy: true,
      });
    }

    audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));

    // Dedup by approx bitrate to offer a few distinct quality options
    const uniqueAudioOptions = [];
    const seenBitrates = new Set();
    
    for (const f of audioFormats) {
      if (!f.abr) continue;
      // Group similar bitrates together (e.g. 130 and 128)
      const groupKbps = Math.round(f.abr / 16) * 16; 
      if (!seenBitrates.has(groupKbps) && groupKbps >= 32) {
        seenBitrates.add(groupKbps);
        uniqueAudioOptions.push(f);
      }
    }

    if (uniqueAudioOptions.length === 0 && audioFormats.length > 0) {
      uniqueAudioOptions.push(audioFormats[0]); // Fallback if no abr info
    }

    uniqueAudioOptions.forEach((audioFmt) => {
      const kbps = Math.round(audioFmt.abr || 128);
      let qualityLabel = 'Standard';
      if (kbps >= 256) qualityLabel = 'Premium Quality';
      else if (kbps >= 128) qualityLabel = 'High Quality';
      else if (kbps >= 64) qualityLabel = 'Medium Quality';
      else qualityLabel = 'Low Quality';
      
      options.push({
        quality: `Audio ${qualityLabel} (${kbps}kbps)`,
        size: audioFmt.filesize ? (audioFmt.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
        format: 'M4A',
        url: '',
        ytId: videoId,
        itag: audioFmt.format_id,
        isAudio: true,
        useProxy: true,
      });
    });

    if (options.length === 0) throw new Error('No formats found for this media.');

    return { success: true, data: { type: 'video', title, thumbnail, options } };
  } catch (ytdlpError) {
    console.error('[YouTube Extractor] yt-dlp failed:', ytdlpError.message);
  }

  // 2. FALLBACK: btch.youtube() — dedicated YouTube method (works on Vercel serverless)
  //    btch.aio() does NOT work for YouTube (returns "Invalid search API response").
  //    btch.youtube() returns { status, title, thumbnail, author, mp3, mp4 }.
  try {
    let btch;
    try { btch = require('btch-downloader'); } catch { btch = null; }
    if (!btch) throw new Error('btch-downloader not available');

    console.log('[YouTube Extractor] FALLBACK: btch.youtube()...');
    const ytRes = await withTimeout(btch.youtube(url), 15000, 'YouTube btch');

    if (ytRes && ytRes.status) {
      const options = [];
      const title = ytRes.title || 'YouTube Media';
      const thumbnail = ytRes.thumbnail || '';

      // MP4 video download
      if (ytRes.mp4 && typeof ytRes.mp4 === 'string' && ytRes.mp4.startsWith('http')) {
        options.push({
          quality: 'HD Video',
          size: 'Auto', format: 'MP4', url: ytRes.mp4, useProxy: true,
        });
      }

      // MP3 audio download
      if (ytRes.mp3 && typeof ytRes.mp3 === 'string' && ytRes.mp3.startsWith('http')) {
        options.push({
          quality: 'Audio (MP3)',
          size: 'Auto', format: 'MP3', url: ytRes.mp3,
          isAudio: true, useProxy: true,
        });
      }

      // Thumbnail image
      if (thumbnail) {
        options.push({
          quality: 'Thumbnail',
          size: 'Auto', format: 'JPG', url: thumbnail,
          isImage: true, imageUrl: thumbnail, useProxy: true,
        });
      }

      if (options.length > 0) {
        return { success: true, data: { type: 'video', title, thumbnail, options } };
      }
    }
  } catch (btchError) {
    console.error('[YouTube Extractor] btch.youtube() failed:', btchError.message);
  }

  // 3. LAST RESORT: btch.aio() (generic, rarely works for YouTube but try anyway)
  try {
    let btch;
    try { btch = require('btch-downloader'); } catch { btch = null; }
    if (btch && btch.aio) {
      console.log('[YouTube Extractor] LAST RESORT: btch.aio()...');
      const aioRes = await withTimeout(btch.aio(url), 10000, 'YouTube AIO');

      if (aioRes && aioRes.data) {
        const items = Array.isArray(aioRes.data) ? aioRes.data : [aioRes.data];
        const options = [];

        items.forEach(item => {
          const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
          if (!mUrl || typeof mUrl !== 'string' || !mUrl.startsWith('http')) return;

          options.push({
            quality: item.quality || 'HD Video',
            size: 'Auto', format: 'MP4', url: mUrl, useProxy: true,
          });
          options.push({
            quality: 'Audio Only',
            size: 'Auto', format: 'M4A', url: mUrl,
            isAudio: true, useProxy: true,
          });
        });

        if (options.length > 0) {
          const title = aioRes.title || 'YouTube Media';
          const thumbnail = aioRes.thumbnail || '';
          return { success: true, data: { type: 'video', title, thumbnail, options } };
        }
      }
    }
  } catch (aioError) {
    console.error('[YouTube Extractor] btch.aio() failed:', aioError.message);
  }

  return { success: false, error: 'YouTube extraction failed. All methods exhausted.' };
};

module.exports = { extractYouTube, withTimeout, ytdlpGetInfoAsync };

