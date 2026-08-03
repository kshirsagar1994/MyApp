const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');

// GUARD: btch-downloader may not be available in all environments
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

/**
 * Normalize Facebook URLs that yt-dlp doesn't support.
 * facebook.com/share/v/xxx → facebook.com/reel/xxx (yt-dlp supported)
 * Also strips tracking params that confuse extractors.
 */
const normalizeFacebookUrl = (url) => {
  try {
    const u = new URL(url);
    // Strip tracking params
    ['mibextid', 'sfnsn', '_nc_sid', '__cft__', '__tn__'].forEach(p => u.searchParams.delete(p));

    // /share/v/ID/ → /reel/ID/  (yt-dlp recognizes /reel/ but not /share/v/)
    const shareMatch = u.pathname.match(/^\/share\/v\/([^/]+)/);
    if (shareMatch) {
      u.pathname = `/reel/${shareMatch[1]}`;
    }
    return u.toString();
  } catch {
    return url;
  }
};

/**
 * Extracts Facebook media (videos, images, audio).
 * Uses yt-dlp as PRIMARY, btch fbdown as FALLBACK 1, btch AIO as FALLBACK 2.
 */
const extractFacebook = async (url, igCookies = null) => {
  try {
    const options = [];
    const normalizedUrl = normalizeFacebookUrl(url);

    // 1. PRIMARY: yt-dlp (try normalized URL first, original as fallback)
    try {
      console.log('[Facebook] PRIMARY: yt-dlp extraction...');
      let info;
      try {
        info = await ytdlpGetInfoAsync(normalizedUrl, [], 25000, igCookies);
      } catch (normErr) {
        // If normalized URL failed and it's different from original, try original
        if (normalizedUrl !== url) {
          console.log('[Facebook] yt-dlp: normalized URL failed, trying original...');
          info = await ytdlpGetInfoAsync(url, [], 25000, igCookies);
        } else {
          throw normErr;
        }
      }

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

    // 2. FALLBACK 1: btch fbdown (dedicated Facebook downloader — more reliable than generic AIO)
    if (btch && btch.fbdown) {
      try {
        console.log('[Facebook] FALLBACK 1: btch fbdown...');
        const fbRes = await withTimeout(btch.fbdown(url), 10000, 'Facebook fbdown');

        if (fbRes && fbRes.status) {
          // fbdown returns { status: true, Normal_video: url, HD: url }
          if (fbRes.HD && typeof fbRes.HD === 'string' && fbRes.HD.startsWith('http')) {
            options.push({
              quality: 'HD Video',
              size: 'Auto', format: 'MP4', url: fbRes.HD, useProxy: true,
            });
            options.push({
              quality: 'Audio Only',
              size: 'Auto', format: 'M4A', url: fbRes.HD, isAudio: true, useProxy: true,
            });
          }
          if (fbRes.Normal_video && typeof fbRes.Normal_video === 'string' && fbRes.Normal_video.startsWith('http')) {
            // Only add SD if it's different from HD
            const hdPath = fbRes.HD ? fbRes.HD.split('?')[0] : '';
            const sdPath = fbRes.Normal_video.split('?')[0];
            if (sdPath !== hdPath) {
              options.push({
                quality: 'SD Video',
                size: 'Auto', format: 'MP4', url: fbRes.Normal_video, useProxy: true,
              });
            }
          }
        }
      } catch (e) {
        console.error('[Facebook] fbdown fallback failed:', e.message);
      }
    }

    // 3. FALLBACK 2: snapsave-media-downloader (reliable for Facebook)
    if (options.length === 0) {
      try {
        console.log('[Facebook] FALLBACK 2: snapsave...');
        let snapsave;
        try {
          const mod = await import('snapsave-media-downloader');
          snapsave = mod.snapsave;
        } catch (err) {
          console.error('[Facebook] snapsave module not found:', err.message);
        }

        if (snapsave) {
          const fbRes = await withTimeout(snapsave(url), 15000, 'Facebook snapsave');
          if (fbRes && fbRes.success && fbRes.data && fbRes.data.media) {
            fbRes.data.media.forEach(m => {
              if (m.url && typeof m.url === 'string' && m.url.startsWith('http')) {
                options.push({
                  quality: m.resolution || 'HD Video',
                  size: 'Auto', format: 'MP4', url: m.url, useProxy: true,
                });
                // Also add an audio option using the video URL
                options.push({
                  quality: 'Audio Only',
                  size: 'Auto', format: 'M4A', url: m.url, isAudio: true, useProxy: true,
                });
              }
            });
            if (fbRes.data.preview) {
               options.push({
                  quality: 'Thumbnail',
                  size: 'Auto', format: 'JPG', url: fbRes.data.preview, isImage: true, imageUrl: fbRes.data.preview, useProxy: true,
               });
            }
          }
        }
      } catch (e) {
        console.error('[Facebook] snapsave fallback failed:', e.message);
      }
    }

    // 4. FALLBACK 3: btch AIO (generic)
    if (options.length === 0 && btch && btch.aio) {
      try {
        console.log('[Facebook] FALLBACK 3: btch AIO...');
        const fbRes = await withTimeout(btch.aio(url), 15000, 'Facebook AIO');

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
