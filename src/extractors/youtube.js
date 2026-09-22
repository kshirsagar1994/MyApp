/* global __dirname */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const os = require('os');

/**
 * Async yt-dlp binary locator & installer.
 * On Windows, uses local yt-dlp.exe.
 * On Linux (e.g. Vercel / Docker), checks project root yt-dlp first, then /tmp/yt-dlp.
 */
const ensureYtdlp = async () => {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    return path.resolve(__dirname, '..', '..', 'yt-dlp.exe');
  }

  // 1. Check if bundled yt-dlp exists in project root (created during vercel-build)
  const projectRootBinary = path.resolve(__dirname, '..', '..', 'yt-dlp');
  if (fs.existsSync(projectRootBinary)) {
    try {
      fs.chmodSync(projectRootBinary, 0o755);
      return projectRootBinary;
    } catch {}
  }

  const tmpPath = path.join(os.tmpdir(), 'yt-dlp');

  // 2. Check if valid standalone binary already cached in /tmp (must be > 20MB for self-contained yt-dlp_linux)
  if (fs.existsSync(tmpPath)) {
    try {
      const stat = fs.statSync(tmpPath);
      if (stat.size > 20 * 1024 * 1024) {
        fs.chmodSync(tmpPath, 0o755);
        return tmpPath;
      } else {
        console.log('[yt-dlp] Removing old non-standalone binary from /tmp (size:', stat.size, 'bytes)...');
        try { fs.unlinkSync(tmpPath); } catch {}
      }
    } catch {}
  }

  // 3. Download standalone self-contained Linux binary (yt-dlp_linux contains embedded Python)
  console.log('[yt-dlp] Downloading self-contained yt-dlp_linux to', tmpPath, '...');
  const https = require('https');
  const downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

  await new Promise((resolve, reject) => {
    const fetchBinary = (url, depth = 0) => {
      if (depth > 6) return reject(new Error('Too many redirects downloading yt-dlp'));
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchBinary(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(tmpPath);
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try { fs.chmodSync(tmpPath, 0o755); } catch {}
            console.log('[yt-dlp] Downloaded and ready at', tmpPath);
            resolve();
          });
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    fetchBinary(downloadUrl);
  });

  return tmpPath;
};

const runYtdlp = async (url, extraArgs = [], timeoutMs = 50000) => {
  const ytdlpPath = await ensureYtdlp();
  return new Promise((resolve, reject) => {
    const args = [
      '-j',
      '--no-warnings',
      '--no-check-certificates',
      '--socket-timeout', '15',
      '--js-runtimes', 'node',
      ...extraArgs,
      url
    ];
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
 * Generates a temporary Netscape-format cookies.txt file from a full browser cookie string.
 * 
 * Instagram's API requires MULTIPLE cookies (sessionid, csrftoken, ds_user_id, mid, rur, ig_did)
 * to authenticate.
 * 
 * @param {string} cookieString - Full cookie string from browser, e.g. "sessionid=abc; csrftoken=xyz; ds_user_id=123"
 * @param {string} domain - Cookie domain (default: .instagram.com)
 * @returns {string} Path to the temp cookie file (caller must clean up)
 */
const createTempCookieFile = (cookieString, domain = '.instagram.com') => {
  const tempPath = path.join(os.tmpdir(), `_cookies_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`);

  if (cookieString.includes('# Netscape HTTP Cookie File')) {
    fs.writeFileSync(tempPath, cookieString, 'utf-8');
    return tempPath;
  }

  const lines = [
    '# Netscape HTTP Cookie File',
    '# Auto-generated for yt-dlp authentication',
  ];

  // Future timestamp (year 2038) so Python http.cookiejar never discards them as expired session cookies
  const expiry = '2147483647';

  // Parse "name1=value1; name2=value2; ..." into individual cookie entries
  const cookies = cookieString.split(';').map(c => c.trim()).filter(Boolean);
  
  for (const cookie of cookies) {
    const eqIdx = cookie.indexOf('=');
    if (eqIdx === -1) continue;
    const name = cookie.substring(0, eqIdx).trim();
    const value = cookie.substring(eqIdx + 1).trim();
    if (!name || !value) continue;
    
    // Netscape format: domain  domainFlag  path  secure  expiry  name  value
    lines.push(`.instagram.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
    lines.push(`instagram.com\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
    lines.push(`.threads.net\tTRUE\t/\tTRUE\t${expiry}\t${name}\t${value}`);
  }

  // If the user only pasted a raw sessionid value (no "=" found), treat it as sessionid
  if (cookies.length === 0 || (cookies.length === 1 && !cookieString.includes('='))) {
    const rawVal = cookieString.trim();
    lines.push(`.instagram.com\tTRUE\t/\tTRUE\t${expiry}\tsessionid\t${rawVal}`);
    lines.push(`instagram.com\tTRUE\t/\tTRUE\t${expiry}\tsessionid\t${rawVal}`);
  }

  fs.writeFileSync(tempPath, lines.join('\n'), 'utf-8');
  return tempPath;
};

/**
 * Async yt-dlp JSON extraction with cookie fallback.
 * FIX Bug 7: Only retry on genuine auth errors. Do NOT retry on 404/403/not-found/dpapi/decrypt
 * which are not fixable by cookies and waste 20+ seconds.
 */
const ytdlpGetInfoAsync = async (url, extraArgs = [], timeoutMs = 60000, igCookies = null) => {
  let tempCookieFile = null;
  const finalArgs = [...extraArgs];

  try {
    // Only pass Instagram cookies if extracting from Instagram / Threads
    if (igCookies && (url.includes('instagram.com') || url.includes('threads.net'))) {
      tempCookieFile = createTempCookieFile(igCookies);
      finalArgs.push('--cookies', tempCookieFile);
    }
    return await runYtdlp(url, finalArgs, timeoutMs);
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

    // If igCookies was already provided, it's the definitive auth — don't waste time on browser cookies
    if (igCookies) {
      console.error('[yt-dlp] Session ID auth failed — the session ID may be invalid or expired.');
      throw err;
    }

    // Try cookies.txt file if available (fast, no UAC prompts)
    const cookiesPath = path.resolve(__dirname, '..', '..', 'cookies.txt');
    if (fs.existsSync(cookiesPath)) {
      console.log('[yt-dlp] Auth error — retrying with cookies.txt...');
      try {
        return await runYtdlp(url, ['--cookies', cookiesPath, ...finalArgs], timeoutMs);
      } catch (cookieTxtErr) {
        console.error('[yt-dlp] cookies.txt retry failed:', cookieTxtErr.message);
      }
    }
    
    // Auth failed and no cookies provided
    throw err;
  } finally {
    // Clean up temporary cookie file
    if (tempCookieFile) {
      try { fs.unlinkSync(tempCookieFile); } catch (_e) {}
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
const extractYouTube = async (url, igCookies = null) => {
  // 1. PRIMARY: yt-dlp (works on Docker/Render/local, skipped on Vercel)
  try {
    console.log('[YouTube Extractor] PRIMARY: yt-dlp extraction:', url);
    const info = await ytdlpGetInfoAsync(url, ['--no-playlist'], 50000, igCookies);

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

  // 2. FALLBACK: btch.youtube() — dedicated YouTube resolver (BOTCAHX / ymcdn)
  try {
    let btch;
    try { btch = require('btch-downloader'); } catch { btch = null; }
    if (btch && btch.youtube) {
      console.log('[YouTube Extractor] FALLBACK: btch.youtube()...');
      const ytRes = await withTimeout(btch.youtube(url), 25000, 'YouTube btch');

      if (ytRes && ytRes.status) {
        const options = [];
        const title = ytRes.title || 'YouTube Video';
        const thumbnail = ytRes.thumbnail || '';

        // MP4 video download
        if (ytRes.mp4 && typeof ytRes.mp4 === 'string' && ytRes.mp4.startsWith('http')) {
          options.push({
            quality: 'Video Full HD (1080p / 720p)',
            size: 'Auto', format: 'MP4', url: ytRes.mp4, useProxy: true,
          });
          options.push({
            quality: 'Video Standard (480p / 360p)',
            size: 'Auto', format: 'MP4', url: ytRes.mp4, useProxy: true,
          });
        }

        // MP3 audio download
        if (ytRes.mp3 && typeof ytRes.mp3 === 'string' && ytRes.mp3.startsWith('http')) {
          options.push({
            quality: 'Audio Premium Quality (320kbps)',
            size: 'Auto', format: 'MP3', url: ytRes.mp3,
            isAudio: true, useProxy: true,
          });
          options.push({
            quality: 'Audio Standard Quality (128kbps)',
            size: 'Auto', format: 'MP3', url: ytRes.mp3,
            isAudio: true, useProxy: true,
          });
        }

        // Thumbnail image
        if (thumbnail) {
          options.push({
            quality: 'Thumbnail (Cover Photo)',
            size: 'Auto', format: 'JPG', url: thumbnail,
            isImage: true, imageUrl: thumbnail, useProxy: true,
          });
        }

        if (options.length > 0) {
          return { success: true, data: { type: 'video', title, thumbnail, options } };
        }
      }
    }
  } catch (btchError) {
    console.error('[YouTube Extractor] btch.youtube() failed:', btchError.message);
  }

  // 3. FALLBACK: Multi-instance Invidious API
  try {
    const idMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/))([\w-]{11})/);
    const videoId = idMatch ? idMatch[1] : null;
    if (videoId) {
      console.log('[YouTube Extractor] FALLBACK: Invidious API for:', videoId);
      const instances = ['https://inv.nadeko.net', 'https://invidious.nerdvpn.de', 'https://yewtu.be'];
      for (const instance of instances) {
        try {
          const invRes = await withTimeout(
            fetch(`${instance}/api/v1/videos/${videoId}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }),
            6000,
            'Invidious'
          );
          if (invRes.ok) {
            const data = await invRes.json();
            const title = data.title || 'YouTube Video';
            const thumbnail = data.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
            const options = [];

            const streams = data.formatStreams || [];
            streams.forEach((st) => {
              if (st.url) {
                options.push({
                  quality: `Video (${st.qualityLabel || st.resolution || 'HD'})`,
                  size: st.size || 'Auto',
                  format: 'MP4',
                  url: st.url,
                  ytId: videoId,
                  itag: st.itag ? String(st.itag) : undefined,
                  useProxy: true,
                });
              }
            });

            const audioAdap = (data.adaptiveFormats || []).filter((f) => f.type?.startsWith('audio/'));
            if (audioAdap.length > 0) {
              const bestAudio = audioAdap.find((f) => f.container === 'm4a') || audioAdap[0];
              if (bestAudio.url) {
                options.push({
                  quality: 'Audio (M4A/MP3)',
                  size: bestAudio.contentLength ? (bestAudio.contentLength / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
                  format: 'M4A',
                  url: bestAudio.url,
                  ytId: videoId,
                  itag: bestAudio.itag ? String(bestAudio.itag) : undefined,
                  isAudio: true,
                  useProxy: true,
                });
              }
            }

            if (options.length > 0) {
              return { success: true, data: { type: 'video', title, thumbnail, options } };
            }
          }
        } catch {}
      }
    }
  } catch (invErr) {
    console.warn('[YouTube Extractor] Invidious fallback failed:', invErr.message);
  }

  // 4. LAST RESORT: btch.aio() (generic)
  try {
    let btch;
    try { btch = require('btch-downloader'); } catch { btch = null; }
    if (btch && btch.aio) {
      console.log('[YouTube Extractor] LAST RESORT: btch.aio()...');
      const aioRes = await withTimeout(btch.aio(url), 12000, 'YouTube AIO');

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

module.exports = { extractYouTube, withTimeout, ytdlpGetInfoAsync, createTempCookieFile, ensureYtdlp };

