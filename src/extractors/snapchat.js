const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');

// GUARD: btch-downloader may not be available in all environments
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

/**
 * Clean Snapchat URLs — remove tracking params that confuse extractors.
 */
const cleanSnapchatUrl = (url) => {
  try {
    const u = new URL(url);
    // Strip common tracking/share params
    ['share_id', 'locale', 'sf', 'sc_referrer'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
};

/**
 * Extracts Snapchat media (stories, spotlight videos, images).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractSnapchat = async (url) => {
  try {
    const options = [];
    const cleanedUrl = cleanSnapchatUrl(url);

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[Snapchat] PRIMARY: yt-dlp extraction...');
      let info;
      try {
        info = await ytdlpGetInfoAsync(cleanedUrl, [], 25000);
      } catch (cleanErr) {
        if (cleanedUrl !== url) {
          console.log('[Snapchat] yt-dlp: cleaned URL failed, trying original...');
          info = await ytdlpGetInfoAsync(url, [], 25000);
        } else {
          throw cleanErr;
        }
      }

      const title = info.title || 'Snapchat Content';
      const thumbnail = info.thumbnail || '';
      const formats = info.formats || [];
      const directUrl = info.url;

      if (formats.length > 0) {
        const videoFormats = formats
          .filter(f => f.vcodec !== 'none' && f.vcodec !== 'images')
          .sort((a, b) => ((b.height || 0) * 1000 + (b.tbr || 0)) - ((a.height || 0) * 1000 + (a.tbr || 0)));

        if (videoFormats.length > 0) {
          const bestVideo = videoFormats[0];
          
          options.push({
            quality: 'HD Video',
            size: bestVideo.filesize ? (bestVideo.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
            format: 'MP4',
            url: bestVideo.url || '',
            useProxy: !!bestVideo.url,
          });

          // Audio
          const audioFormats = formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
          if (audioFormats.length > 0) {
            const bestAudio = audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
            options.push({
              quality: `Audio Only (${Math.round(bestAudio.abr || 128)}kbps)`,
              size: 'Auto', format: 'M4A',
              url: bestAudio.url || '', isAudio: true, useProxy: !!bestAudio.url,
            });
          } else {
            // fallback: push the video url as audio if no separate audio format is found
            options.push({
              quality: 'Audio Only',
              size: 'Auto', format: 'M4A',
              url: bestVideo.url || '', isAudio: true, useProxy: !!bestVideo.url,
            });
          }

          // Image (Thumbnail)
          if (thumbnail || directUrl) {
            options.push({
              quality: 'High Res Photo',
              size: 'Auto', format: 'JPG',
              url: thumbnail || directUrl, isImage: true, imageUrl: thumbnail || directUrl, useProxy: true,
            });
          }
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

    // 2. FALLBACK: btch AIO (increased timeout to 12s)
    if (btch && btch.aio) {
      try {
        console.log('[Snapchat] FALLBACK: btch AIO...');
        const snpRes = await withTimeout(btch.aio(url), 12000, 'Snapchat AIO');

        if (snpRes && snpRes.data) {
          const mediaArray = Array.isArray(snpRes.data) ? snpRes.data : [snpRes.data];
          mediaArray.forEach((item) => {
            const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
            if (!mUrl) return;
            const isImg = mUrl.split('?')[0].toLowerCase().match(/\.(jpg|jpeg|png|webp)/);
            
            if (isImg) {
              options.push({
                quality: 'High Res Photo',
                size: 'Auto', format: 'JPG', url: mUrl, isImage: true, imageUrl: item.thumbnail || mUrl, useProxy: true,
              });
            } else {
              options.push({
                quality: 'HD Video',
                size: 'Auto', format: 'MP4', url: mUrl, useProxy: true,
              });
              options.push({
                quality: 'Audio Only',
                size: 'Auto', format: 'M4A', url: mUrl, isAudio: true, useProxy: true,
              });
              if (item.thumbnail) {
                options.push({
                  quality: 'High Res Photo',
                  size: 'Auto', format: 'JPG', url: item.thumbnail, isImage: true, imageUrl: item.thumbnail, useProxy: true,
                });
              }
            }
          });
        }
      } catch (e) {
        console.error('[Snapchat] AIO fallback failed:', e.message);
      }
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
