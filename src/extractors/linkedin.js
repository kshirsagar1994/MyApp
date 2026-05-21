const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts LinkedIn media (videos, images, audio from posts).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractLinkedIn = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[LinkedIn] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'LinkedIn Media';
      const thumbnail = info.thumbnail || '';
      const formats = info.formats || [];
      const directUrl = info.url;

      if (formats.length > 0) {
        const videoFormats = formats
          .filter(f => f.vcodec !== 'none')
          .sort((a, b) => ((b.height || 0) * 1000 + (b.tbr || 0)) - ((a.height || 0) * 1000 + (a.tbr || 0)));

        const seenHeights = new Set();
        for (const f of videoFormats) {
          const h = f.height || 0;
          if (seenHeights.has(h)) continue;
          seenHeights.add(h);
          const label = h >= 1080 ? 'Full HD' : h >= 720 ? 'HD' : h >= 480 ? 'SD' : 'Low';
          options.push({
            quality: `Video ${label} (${h}p)`,
            size: f.filesize ? (f.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
            format: 'MP4',
            url: f.url || '',
            useProxy: !!f.url,
          });
          if (options.length >= 4) break;
        }

        // Audio
        const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
        if (audioFormats.length > 0) {
          const best = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
          options.push({
            quality: `Audio Only (${Math.round(best.abr || 128)}kbps)`,
            size: 'Auto', format: 'MP3',
            url: best.url || '', isAudio: true, useProxy: !!best.url,
          });
        }
      }

      if (options.length === 0 && directUrl) {
        const isImage = directUrl.match(/\.(jpg|jpeg|png|webp)/i);
        options.push({
          quality: isImage ? 'Photo' : 'Best Quality',
          size: 'Auto',
          format: isImage ? 'JPG' : 'MP4',
          url: directUrl,
          isImage: !!isImage,
          useProxy: true,
        });
      }

      if (options.length > 0) {
        return { success: true, data: { type: 'video', title, thumbnail, options } };
      }
    } catch (err) {
      console.error('[LinkedIn] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO
    try {
      console.log('[LinkedIn] FALLBACK: btch AIO...');
      const lkRes = await withTimeout(btch.aio(url), 12000, 'LinkedIn AIO');

      if (lkRes && lkRes.data) {
        const items = Array.isArray(lkRes.data) ? lkRes.data : [lkRes.data];
        items.forEach(item => {
          const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
          if (mUrl && typeof mUrl === 'string' && mUrl.startsWith('http')) {
            const isImage = mUrl.match(/\.(jpg|jpeg|png|webp)/i);
            options.push({
              quality: isImage ? 'Photo' : 'LinkedIn Video',
              size: 'Auto',
              format: isImage ? 'JPG' : 'MP4',
              url: mUrl,
              isImage: !!isImage,
              useProxy: true,
            });
          }
        });
      }
    } catch (e) {
      console.error('[LinkedIn] AIO fallback failed:', e.message);
    }

    if (options.length > 0) {
      return { success: true, data: { type: 'video', title: 'LinkedIn Media', options } };
    }

    throw new Error('LinkedIn extraction failed. Ensure the link is a public post with media.');

  } catch (error) {
    console.error('[LinkedIn Extractor] Error:', error.message);
    return { success: false, error: error.message || 'LinkedIn extraction failed.' };
  }
};

module.exports = { extractLinkedIn };
