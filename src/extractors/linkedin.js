const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');

// GUARD: btch-downloader may not be available in all environments
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

/**
 * Clean LinkedIn URLs — remove tracking params that confuse extractors.
 */
const cleanLinkedInUrl = (url) => {
  try {
    const u = new URL(url);
    // Strip common LinkedIn tracking/share params
    ['miniProfileUrn', 'lipi', 'lici', 'trk', 'originalSubdomain', 'trackingId'].forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch {
    return url;
  }
};

/**
 * Extracts LinkedIn media (videos, images, audio from posts).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractLinkedIn = async (url, igSessionId = null) => {
  try {
    const options = [];
    const cleanedUrl = cleanLinkedInUrl(url);

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[LinkedIn] PRIMARY: yt-dlp extraction...');
      let info;
      try {
        info = await ytdlpGetInfoAsync(cleanedUrl, [], 25000, igSessionId);
      } catch (cleanErr) {
        if (cleanedUrl !== url) {
          console.log('[LinkedIn] yt-dlp: cleaned URL failed, trying original...');
          info = await ytdlpGetInfoAsync(url, [], 25000, igSessionId);
        } else {
          throw cleanErr;
        }
      }

      const title = info.title || 'LinkedIn Media';
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
        } else if (directUrl) {
          const isImage = directUrl.match(/\.(jpg|jpeg|png|webp)/i) || (info.vcodec === 'none' && info.acodec === 'none');
          if (isImage) {
            options.push({
              quality: 'High Res Photo',
              size: 'Auto', format: 'JPG', url: directUrl, isImage: true, imageUrl: directUrl, useProxy: true,
            });
          }
        }
      }

      if (options.length > 0) {
        return { success: true, data: { type: 'video', title, thumbnail, options } };
      }
    } catch (err) {
      console.error('[LinkedIn] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO (increased timeout to 12s)
    if (btch && btch.aio) {
      try {
        console.log('[LinkedIn] FALLBACK: btch AIO...');
        const lkRes = await withTimeout(btch.aio(url), 12000, 'LinkedIn AIO');

        if (lkRes && lkRes.data) {
          const items = Array.isArray(lkRes.data) ? lkRes.data : [lkRes.data];
          items.forEach(item => {
            const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
            if (mUrl && typeof mUrl === 'string' && mUrl.startsWith('http')) {
              const isImage = mUrl.match(/\.(jpg|jpeg|png|webp)/i);
              const isAudio = mUrl.match(/\.(mp3|m4a)/i);
              
              if (isImage) {
                options.push({
                  quality: 'High Res Photo',
                  size: 'Auto', format: 'JPG', url: mUrl, isImage: true, imageUrl: item.thumbnail || mUrl, useProxy: true,
                });
              } else if (!isAudio) {
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
            }
          });
        }
      } catch (e) {
        console.error('[LinkedIn] AIO fallback failed:', e.message);
      }
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
