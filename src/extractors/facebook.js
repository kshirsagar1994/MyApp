const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');
const btch = require('btch-downloader');

/**
 * Extracts Facebook media (videos, images, audio).
 * Uses yt-dlp as PRIMARY, btch AIO as fallback.
 */
const extractFacebook = async (url) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[Facebook] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 45000);

      const title = info.title || 'Facebook Media';
      const thumbnail = info.thumbnail || '';
      const formats = info.formats || [];
      const directUrl = info.url;

      if (formats.length > 0) {
        const videoFormats = formats
          .filter(f => f.vcodec !== 'none' && f.vcodec !== 'images')
          .sort((a, b) => ((b.height || 0) * 1000 + (b.tbr || 0)) - ((a.height || 0) * 1000 + (a.tbr || 0)));

        if (videoFormats.length > 0) {
          const bestVideo = videoFormats[0];
          const h = bestVideo.height || 0;
          const label = h >= 1080 ? 'HD Video' : 'SD Video';
          
          options.push({
            quality: label,
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
          // If no video formats, it might be a pure photo post
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
      console.error('[Facebook] yt-dlp failed:', err.message);
    }

    // 2. FALLBACK: btch AIO
    try {
      console.log('[Facebook] FALLBACK: btch AIO...');
      const fbRes = await withTimeout(btch.aio(url), 12000, 'Facebook AIO');

      if (fbRes && fbRes.data) {
        const items = Array.isArray(fbRes.data) ? fbRes.data : [fbRes.data];
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
      console.error('[Facebook] AIO fallback failed:', e.message);
    }

    if (options.length > 0) {
      return { success: true, data: { type: 'video', title: 'Facebook Media', options } };
    }

    throw new Error('All Facebook extractors failed. Make sure the post is public.');

  } catch (error) {
    console.error('[Facebook Extractor] Error:', error.message);
    return { success: false, error: error.message || 'Facebook extraction blocked or timed out.' };
  }
};

module.exports = { extractFacebook };
