const { spawn } = require('child_process');
const path = require('path');

/**
 * Async yt-dlp JSON extraction — non-blocking.
 */
const runYtdlp = (url, extraArgs = [], timeoutMs = 45000) => {
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
 * Async yt-dlp JSON extraction with cookie fallbacks.
 */
const ytdlpGetInfoAsync = async (url, extraArgs = [], timeoutMs = 45000) => {
  try {
    return await runYtdlp(url, extraArgs, timeoutMs);
  } catch (err) {
    const msg = err.message ? err.message.toLowerCase() : '';
    const needsAuth = msg && (
      msg.includes('login') ||
      msg.includes('cookies') ||
      msg.includes('authentication') ||
      msg.includes('private') ||
      msg.includes('empty media response') ||
      msg.includes('no video') ||
      msg.includes('instagram api is not granting access') ||
      msg.includes('404') ||
      msg.includes('403') ||
      msg.includes('401') ||
      msg.includes('unauthorized') ||
      msg.includes('forbidden') ||
      msg.includes('not found')
    );
    if (!needsAuth) throw err;

    console.log('[yt-dlp] Retrying with browser cookies...');
    const browsers = ['chrome', 'edge', 'firefox', 'brave', 'opera'];
    let lastErr = err;
    
    for (const browser of browsers) {
      console.log(`[yt-dlp] Trying cookies from ${browser}...`);
      try {
        return await runYtdlp(url, ['--cookies-from-browser', browser, ...extraArgs], timeoutMs);
      } catch (cookieErr) {
        lastErr = cookieErr;
        const cMsg = cookieErr.message ? cookieErr.message.toLowerCase() : '';
        const stillNeedsAuth = cMsg && (
          cMsg.includes('could not copy') ||
          cMsg.includes('could not find') ||
          cMsg.includes('login') ||
          cMsg.includes('cookies') ||
          cMsg.includes('authentication') ||
          cMsg.includes('private') ||
          cMsg.includes('registered users') ||
          cMsg.includes('empty media response') ||
          cMsg.includes('no video') ||
          cMsg.includes('instagram api is not granting access') ||
          cMsg.includes('404') ||
          cMsg.includes('403') ||
          cMsg.includes('401') ||
          cMsg.includes('unauthorized') ||
          cMsg.includes('forbidden') ||
          cMsg.includes('not found')
        );
        if (stillNeedsAuth) {
          continue;
        }
        throw cookieErr;
      }
    }
    
    // If all browsers failed, throw the last relevant error
    throw lastErr;
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
 */
const extractYouTube = async (url) => {
  try {
    console.log('[YouTube Extractor] Extracting:', url);
    const info = await ytdlpGetInfoAsync(url, ['--no-playlist'], 45000);

    const videoId = info.id;
    const title = info.title || 'YouTube Media';
    const thumbnail = info.thumbnail || '';
    const options = [];

    const formats = info.formats || [];
    const heights = [2160, 1440, 1080, 720, 480, 360];

    const preMergedFormats = formats.filter(fmt => fmt.vcodec !== 'none' && fmt.acodec !== 'none');
    preMergedFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

    const uniqueHeights = [...new Set(preMergedFormats.map(f => f.height))];

    uniqueHeights.forEach((h) => {
      const f = preMergedFormats.find((fmt) => fmt.height === h);
      if (f) {
        const label = h >= 2160 ? '4K' : h >= 1440 ? '2K' : h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : 'SD';
        options.push({
          quality: `Video ${label} (${h}p)`,
          size: f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
          format: 'MP4',
          url: '',
          ytId: videoId,
          itag: f.format_id,
          note: 'Includes Sound',
          useProxy: true,
        });
      }
    });

    // Fallback best quality
    if (options.length === 0) {
      options.push({
        quality: 'Best Available',
        size: 'Auto', format: 'MP4', url: '',
        ytId: videoId, itag: 'best', useProxy: true,
      });
    }

    // Audio
    const bestAudio = formats
      .filter((f) => f.vcodec === 'none' && f.acodec !== 'none' && f.ext === 'm4a')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0] || 
      formats.filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    if (bestAudio) {
      options.push({
        quality: `Audio Only (${Math.round(bestAudio.abr || 128)}kbps)`,
        size: bestAudio.filesize ? (bestAudio.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
        format: 'M4A',
        url: '',
        ytId: videoId,
        itag: bestAudio.format_id,
        isAudio: true,
        useProxy: true,
      });
    }

    if (options.length === 0) throw new Error('No formats found for this media.');

    return { success: true, data: { type: 'video', title, thumbnail, options } };
  } catch (error) {
    console.error('[YouTube Extractor] Error:', error.message);
    return { success: false, error: error.message || 'YouTube extraction failed or timed out' };
  }
};

module.exports = { extractYouTube, withTimeout, ytdlpGetInfoAsync };
