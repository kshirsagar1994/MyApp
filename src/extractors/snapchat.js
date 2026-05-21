const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts Snapchat media (stories, spotlight videos, images).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractSnapchat = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[Snapchat] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'Snapchat Content';
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
          options.push({
            quality: `Video (${h}p)`,
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
          quality: isImage ? 'HD Photo' : 'HD Video',
          size: 'Auto',
          format: isImage ? 'JPG' : 'MP4',
          url: directUrl,
          isImage: !!isImage,
          imageUrl: isImage ? directUrl : thumbnail,
          useProxy: true,
        });
      }

      if (options.length > 0) {
        return { success: true, data: { type: 'mixed', title, thumbnail, options } };
      }
    } catch (err) {
      console.error('[Snapchat] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO
    try {
      console.log('[Snapchat] FALLBACK: btch AIO...');
      const snpRes = await withTimeout(btch.aio(url), 12000, 'Snapchat AIO');

      if (snpRes && snpRes.data) {
        const mediaArray = Array.isArray(snpRes.data) ? snpRes.data : [snpRes.data];
        mediaArray.forEach((item) => {
          const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
          if (!mUrl) return;
          const isImg = mUrl.split('?')[0].toLowerCase().match(/\.(jpg|jpeg|png|webp)/);
          options.push({
            quality: isImg ? 'HD Photo' : 'HD Video',
            size: 'Auto',
            format: isImg ? 'JPG' : 'MP4',
            url: mUrl,
            imageUrl: isImg ? mUrl : (item.thumbnail || null),
            isImage: !!isImg,
            useProxy: true,
          });
        });
      }
    } catch (e) {
      console.error('[Snapchat] AIO fallback failed:', e.message);
    }

    if (options.length > 0) {
      return { success: true, data: { type: 'mixed', title: 'Snapchat Content', options } };
    }

    throw new Error('All Snapchat extractors failed. The story/post may be private or expired.');

  } catch (error) {
    console.error('[Snapchat Extractor] Error:', error.message);
    return { success: false, error: error.message || 'Snapchat extraction failed.' };
  }
};

module.exports = { extractSnapchat };
