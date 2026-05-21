const { spawn } = require('child_process');
const path = require('path');

/**
 * Async yt-dlp JSON extraction — non-blocking.
 */
const ytdlpGetInfoAsync = (url, extraArgs = [], timeoutMs = 45000) => {
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
        const errMsg = stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
        return reject(new Error(errMsg));
      }
      try { resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error('Failed to parse yt-dlp output')); }
    });

    proc.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
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

    heights.forEach((h) => {
      const f = formats.find((fmt) => fmt.height === h && fmt.vcodec !== 'none');
      if (f) {
        const label = h >= 2160 ? '4K' : h >= 1440 ? '2K' : h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : 'SD';
        options.push({
          quality: `Video ${label} (${h}p)`,
          size: f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
          format: 'MP4',
          url: '',
          ytId: videoId,
          itag: f.format_id,
          note: f.acodec === 'none' ? 'Video only — audio will be merged' : '',
          useProxy: true,
        });
      }
    });

    // Fallback best quality
    if (options.length === 0) {
      options.push({
        quality: 'Best Available',
        size: 'Auto', format: 'MP4', url: '',
        ytId: videoId, itag: 'bestvideo+bestaudio/best', useProxy: true,
      });
    }

    // Audio
    const bestAudio = formats
      .filter((f) => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    if (bestAudio) {
      options.push({
        quality: `Audio Only (${Math.round(bestAudio.abr || 128)}kbps)`,
        size: bestAudio.filesize ? (bestAudio.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
        format: 'MP3',
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
