const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Async yt-dlp JSON extraction — non-blocking.
 */
const runYtdlp = (url, extraArgs = [], timeoutMs = 20000) => {
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
    // Only retry if it's genuinely an auth/login issue
    const needsAuth = msg && (
      msg.includes('login') ||
      msg.includes('cookies') ||
      msg.includes('authentication') ||
      msg.includes('private') ||
      msg.includes('empty media response') ||
      msg.includes('instagram api is not granting access')
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
        throw cookieTxtErr;
      }
    }
    
    // No cookies.txt and auth required — fail immediately
    // We intentionally SKIP --cookies-from-browser because recent Chrome/Edge versions 
    // use App-Bound encryption on Windows, which causes yt-dlp to completely hang 
    // waiting for UAC prompts or decryption, leading to massive timeouts.
    throw err;
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
      // Prioritize pre-merged H.264 MP4 streams (have both video+audio)
      // These stream directly without ffmpeg and play on ALL mobile devices.
      // Only fall back to video-only if no pre-merged format exists at this height.
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
          // If pre-merged (has audio), use single format ID (streams directly, no ffmpeg).
          // If video-only, combine with best audio → requires ffmpeg merge on server.
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
  } catch (error) {
    console.error('[YouTube Extractor] Error:', error.message);
    return { success: false, error: error.message || 'YouTube extraction failed or timed out' };
  }
};

module.exports = { extractYouTube, withTimeout, ytdlpGetInfoAsync };
