const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');

// GUARD: btch-downloader may not be available in all environments
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

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
      const info = await ytdlpGetInfoAsync(url, [], 20000);

      const title = info.title || 'Instagram Post/Reel';
      const thumbnail = info.thumbnail || (info.entries && info.entries[0]?.thumbnail) || '';
      
      const entries = info.entries ? info.entries : [info];
      let vCount = 0;
      let pCount = 0;

      entries.forEach((entry) => {
        const formats = entry.formats || [];
        const directUrl = entry.url;
        
        // Determine if it's explicitly an image
        const ext = (entry.ext || '').toLowerCase();
        const isExplicitImage = ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp' || 
                               (directUrl && directUrl.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) ||
                               (entry.vcodec === 'none' && entry.acodec === 'none');

        const videoFormats = formats
            .filter(f => f.vcodec !== 'none' && f.vcodec !== 'images' && f.ext !== 'mhtml')
            .sort((a, b) => ((b.height || 0) * 1000 + (b.tbr || 0)) - ((a.height || 0) * 1000 + (a.tbr || 0)));

        if (videoFormats.length > 0 && !isExplicitImage) {
            const bestVideo = videoFormats[0];
            vCount++;
            options.push({
              quality: `HD Video ${entries.length > 1 ? vCount : ''}`.trim(),
              size: bestVideo.filesize ? (bestVideo.filesize / 1024 / 1024).toFixed(1) + ' MB' : 'Auto',
              format: 'MP4',
              url: bestVideo.url,
              useProxy: true,
            });
            options.push({
              quality: `Audio Only ${entries.length > 1 ? vCount : ''}`.trim(),
              size: 'Auto',
              format: 'M4A',
              url: bestVideo.url,
              isAudio: true,
              useProxy: true,
            });
            // Also provide the thumbnail as an image option for videos
            if (entry.thumbnail || directUrl) {
              pCount++;
              options.push({
                quality: `High Res Photo ${entries.length > 1 ? pCount : ''}`.trim(),
                size: 'Auto',
                format: 'JPG',
                url: entry.thumbnail || directUrl,
                isImage: true,
                imageUrl: entry.thumbnail || directUrl,
                useProxy: true,
              });
            }
        } else if (directUrl) {
           // No video formats found or explicitly an image
           
           // FIX Bug 6: Find the highest resolution image available.
           // Instagram's yt-dlp output often has thumbnails sorted by size.
           // Pick the largest thumbnail, or the highest-res format URL.
           let bestImageUrl = directUrl;

           // Check thumbnails array — pick the one with the largest dimensions
           if (entry.thumbnails && entry.thumbnails.length > 0) {
             const sorted = [...entry.thumbnails].sort((a, b) => {
               const aSize = (a.width || 0) * (a.height || 0);
               const bSize = (b.width || 0) * (b.height || 0);
               return bSize - aSize;
             });
             if (sorted[0]?.url) bestImageUrl = sorted[0].url;
           }

           // Check formats for image-type entries with higher resolution
           if (formats.length > 0) {
             const imageFormats = formats
               .filter(f => f.url && (f.vcodec === 'images' || f.vcodec === 'none' || f.ext === 'jpg' || f.ext === 'webp'))
               .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
             if (imageFormats.length > 0 && imageFormats[0].url) {
               bestImageUrl = imageFormats[0].url;
             }
           }

           pCount++;
           options.push({
             quality: `High Res Photo ${entries.length > 1 ? pCount : ''}`.trim(),
             size: 'Auto',
             format: ext === 'webp' ? 'WEBP' : 'JPG',
             url: bestImageUrl,
             isImage: true,
             imageUrl: bestImageUrl,
             useProxy: true,
           });
        }
      });

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
    if (btch && btch.igdl) try {
      console.log('[Instagram] FALLBACK: btch igdl...');
      const igRes = await withTimeout(btch.igdl(url), 8000, 'Instagram IGDL');

      // FIX Bug 2 & 11: Filter out empty objects before processing.
      // btch igdl often returns [{}, {}, {}, ...] which wastes CPU cycles.
      if (igRes && Array.isArray(igRes.result)) {
        const validResults = igRes.result.filter(item => item && Object.keys(item).length > 0);
        
        if (validResults.length > 0) {
          let vCount = 0;
          let pCount = 0;
          validResults.forEach((item) => {
            const mediaItems = item.media && Array.isArray(item.media) ? item.media : [item];
            mediaItems.forEach((m) => {
              const mUrl = typeof m === 'string' ? m : (m.url || m.download_link);
              if (!mUrl) return;
              
              let decodedUrl = mUrl;
              if (mUrl.includes('token=')) {
                try {
                  const token = mUrl.split('token=')[1].split('&')[0];
                  const payload = token.split('.')[1];
                  if (payload) {
                     const decoded = Buffer.from(payload, 'base64').toString('utf-8');
                     const parsed = JSON.parse(decoded);
                     if (parsed.url) decodedUrl = parsed.url;
                  }
                } catch (e) {}
              }
              
              const isImage = decodedUrl.match(/\.(jpg|jpeg|png|webp)/i);
              
              if (isImage) {
                pCount++;
                options.push({
                  quality: `High Res Photo ${pCount}`,
                  size: 'Auto', format: 'JPG', url: decodedUrl,
                  imageUrl: decodedUrl,
                  isImage: true, useProxy: true,
                });
              } else {
                vCount++;
                options.push({
                  quality: `HD Video ${vCount}`,
                  size: 'Auto', format: 'MP4', url: decodedUrl, useProxy: true,
                  imageUrl: m.thumbnail || null,
                });
                options.push({
                  quality: `Audio Only ${vCount}`,
                  size: 'Auto', format: 'M4A', url: decodedUrl, isAudio: true, useProxy: true,
                  imageUrl: m.thumbnail || null,
                });
              }
            });
          });
        }
      }
    } catch (e) {
      console.error('[Instagram] igdl fallback failed:', e.message);
    }

    // 3. FALLBACK: btch AIO
    if (options.length === 0 && btch && btch.aio) {
      try {
        console.log('[Instagram] FALLBACK: btch AIO...');
        const aioRes = await withTimeout(btch.aio(url), 10000, 'Instagram AIO');
        if (aioRes && aioRes.data) {
          let vCount = 0;
          let pCount = 0;
          const items = Array.isArray(aioRes.data) ? aioRes.data : [aioRes.data];
          items.forEach(item => {
            const mUrl = typeof item === 'string' ? item : (item.url || item.download_link);
            if (!mUrl || !mUrl.startsWith('http')) return;
            
            let decodedUrl = mUrl;
            if (mUrl.includes('token=')) {
              try {
                const token = mUrl.split('token=')[1].split('&')[0];
                const payload = token.split('.')[1];
                if (payload) {
                   const decoded = Buffer.from(payload, 'base64').toString('utf-8');
                   const parsed = JSON.parse(decoded);
                   if (parsed.url) decodedUrl = parsed.url;
                }
              } catch (e) {}
            }
            
            const isImage = decodedUrl.match(/\.(jpg|jpeg|png|webp)/i);
            if (isImage) {
              pCount++;
              options.push({
                quality: `High Res Photo ${pCount}`,
                size: 'Auto', format: 'JPG', url: decodedUrl, isImage: true, useProxy: true,
                imageUrl: decodedUrl,
              });
            } else {
              vCount++;
              options.push({
                quality: `HD Video ${vCount}`,
                size: 'Auto', format: 'MP4', url: decodedUrl, useProxy: true,
                imageUrl: item.thumbnail || null,
              });
              options.push({
                quality: `Audio Only ${vCount}`,
                size: 'Auto', format: 'M4A', url: decodedUrl, isAudio: true, useProxy: true,
                imageUrl: item.thumbnail || null,
              });
            }
          });
        }
      } catch (e) {
        console.error('[Instagram] AIO fallback failed:', e.message);
      }
    }

    if (options.length > 0) {
      // FIX Bug 5: Robust deduplication — by URL path AND quality label.
      // This catches CDN-variant duplicates (same image, different query params)
      // and also catches same-URL items appearing with different quality labels.
      const uniqueOptions = [];
      const seenKeys = new Set();
      options.forEach(opt => {
        // Normalize URL: strip query params and fragments for comparison
        const urlPath = opt.url.split('?')[0].split('#')[0];
        // Combine URL path + format + isImage/isAudio flags for a unique key
        const key = `${urlPath}|${opt.format}|${opt.isImage ? 'img' : opt.isAudio ? 'aud' : 'vid'}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          uniqueOptions.push(opt);
        }
      });

      return {
        success: true,
        data: { type: uniqueOptions.every(o => o.isImage) ? 'image' : 'mixed', title: 'Instagram Post/Reel', options: uniqueOptions },
      };
    }

    throw new Error('All Instagram extractors failed or no valid options were found for this URL type.');

  } catch (error) {
    console.error('[Instagram Extractor] Error:', error.message);
    return { success: false, error: error.message || 'Instagram extraction blocked.' };
  }
};

module.exports = { extractInstagram };
