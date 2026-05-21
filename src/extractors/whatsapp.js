const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts WhatsApp media (status videos, shared links).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractWhatsApp = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[WhatsApp] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'WhatsApp Media';
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
          if (options.length >= 3) break;
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
        return { success: true, data: { type: 'mixed', title, thumbnail, options } };
      }
    } catch (err) {
      console.error('[WhatsApp] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO
    try {
      console.log('[WhatsApp] FALLBACK: btch AIO...');
      const waRes = await withTimeout(btch.aio(url), 12000, 'WhatsApp AIO');

      if (waRes && waRes.data) {
        const items = Array.isArray(waRes.data) ? waRes.data : [waRes.data];
        items.forEach(item => {
          const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
          if (mUrl && typeof mUrl === 'string' && mUrl.startsWith('http')) {
            const isImage = mUrl.match(/\.(jpg|jpeg|png|webp)/i);
            options.push({
              quality: isImage ? 'Photo' : 'Video',
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
      console.error('[WhatsApp] AIO fallback failed:', e.message);
    }

    if (options.length > 0) {
      return { success: true, data: { type: 'mixed', title: 'WhatsApp Media', options } };
    }

    throw new Error('WhatsApp extraction failed. The link may be expired or private.');

  } catch (error) {
    console.error('[WhatsApp Extractor] Error:', error.message);
    return { success: false, error: error.message || 'WhatsApp extraction failed.' };
  }
};

module.exports = { extractWhatsApp };
