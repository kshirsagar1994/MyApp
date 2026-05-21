const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts Instagram media (posts, reels, stories, carousel).
 * Uses yt-dlp as PRIMARY (reliable), btch-downloader as fallback.
 */
const extractInstagram = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp (supports Instagram posts, reels, stories)
    try {
      console.log('[Instagram] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'Instagram Post/Reel';
      const thumbnail = info.thumbnail || '';
      const formats = info.formats || [];
      const directUrl = info.url;

      if (formats.length > 0) {
        // Video formats
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

      // Direct URL (single photo/video)
      if (options.length === 0 && directUrl) {
        const isImage = directUrl.match(/\.(jpg|jpeg|png|webp)/i);
        options.push({
          quality: isImage ? 'High Res Photo' : 'HD Video',
          size: 'Auto',
          format: isImage ? 'JPG' : 'MP4',
          url: directUrl,
          isImage: !!isImage,
          imageUrl: isImage ? directUrl : thumbnail,
          useProxy: true,
        });
      }

      if (options.length > 0) {
        return {
          success: true,
          data: { type: options.every(o => o.isImage) ? 'image' : 'mixed', title, thumbnail, options },
        };
      }
    } catch (err) {
      console.error('[Instagram] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch-downloader igdl
    try {
      console.log('[Instagram] FALLBACK: btch igdl...');
      const igRes = await withTimeout(btch.igdl(url), 12000, 'Instagram IGDL');

      if (igRes && Array.isArray(igRes.result) && igRes.result.length > 0) {
        igRes.result.forEach((item) => {
          const mediaItems = item.media && Array.isArray(item.media) ? item.media : [item];
          mediaItems.forEach((m) => {
            const mUrl = m.url || m.download_link;
            if (!mUrl) return;
            const isImage = mUrl.includes('.jpg') || mUrl.includes('.jpeg') || mUrl.includes('.png');
            options.push({
              quality: isImage ? 'High Res Photo' : 'HD Video',
              size: 'Auto',
              format: isImage ? 'JPG' : 'MP4',
              url: mUrl,
              imageUrl: m.thumbnail || (isImage ? mUrl : null),
              isImage,
              useProxy: true,
            });
          });
        });
      }
    } catch (e) {
      console.error('[Instagram] igdl fallback failed:', e.message);
    }

    // 3. FALLBACK: btch AIO
    if (options.length === 0) {
      try {
        console.log('[Instagram] FALLBACK: btch AIO...');
        const aioRes = await withTimeout(btch.aio(url), 12000, 'Instagram AIO');
        if (aioRes && aioRes.data) {
          const items = Array.isArray(aioRes.data) ? aioRes.data : [aioRes.data];
          items.forEach(item => {
            const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
            if (!mUrl || !mUrl.startsWith('http')) return;
            const isImage = mUrl.match(/\.(jpg|jpeg|png|webp)/i);
            options.push({
              quality: isImage ? 'Photo' : 'Video',
              size: 'Auto',
              format: isImage ? 'JPG' : 'MP4',
              url: mUrl,
              isImage: !!isImage,
              useProxy: true,
            });
          });
        }
      } catch (e) {
        console.error('[Instagram] AIO fallback failed:', e.message);
      }
    }

    if (options.length > 0) {
      return {
        success: true,
        data: { type: 'mixed', title: 'Instagram Post/Reel', options },
      };
    }

    throw new Error('All Instagram extractors failed. The content may be private or the URL is invalid.');

  } catch (error) {
    console.error('[Instagram Extractor] Error:', error.message);
    return { success: false, error: error.message || 'Instagram extraction blocked.' };
  }
};

module.exports = { extractInstagram };
