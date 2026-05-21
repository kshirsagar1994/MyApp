const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts TikTok media (videos, slideshows).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractTikTok = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp (excellent TikTok support)
    try {
      console.log('[TikTok] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'TikTok Video';
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

      // Direct URL fallback
      if (options.length === 0 && directUrl) {
        options.push({
          quality: 'HD Video',
          size: 'Auto',
          format: 'MP4',
          url: directUrl,
          useProxy: true,
        });
      }

      if (options.length > 0) {
        return { success: true, data: { type: 'video', title, thumbnail, options } };
      }
    } catch (err) {
      console.error('[TikTok] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO
    try {
      console.log('[TikTok] FALLBACK: btch AIO...');
      const ttkRes = await withTimeout(btch.aio(url), 12000, 'TikTok AIO');

      if (ttkRes && ttkRes.data) {
        const items = Array.isArray(ttkRes.data) ? ttkRes.data : [ttkRes.data];
        items.forEach(item => {
          const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
          if (mUrl && typeof mUrl === 'string' && mUrl.startsWith('http')) {
            const isImage = mUrl.match(/\.(jpg|jpeg|png|webp)/i);
            options.push({
              quality: isImage ? 'Photo' : 'HD Video (No Watermark)',
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
      console.error('[TikTok] AIO fallback failed:', e.message);
    }

    if (options.length > 0) {
      return { success: true, data: { type: 'video', title: 'TikTok Video', options } };
    }

    throw new Error('All TikTok extractors failed. The video may be private or the URL is invalid.');

  } catch (error) {
    console.error('[TikTok Extractor] Error:', error.message);
    return { success: false, error: error.message || 'TikTok extraction failed.' };
  }
};

module.exports = { extractTikTok };
