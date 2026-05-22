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
           pCount++;
           options.push({
             quality: `High Res Photo ${entries.length > 1 ? pCount : ''}`.trim(),
             size: 'Auto',
             format: ext === 'webp' ? 'WEBP' : 'JPG',
             url: directUrl,
             isImage: true,
             imageUrl: directUrl || entry.thumbnail,
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
    try {
      console.log('[Instagram] FALLBACK: btch igdl...');
      const igRes = await withTimeout(btch.igdl(url), 12000, 'Instagram IGDL');

      if (igRes && Array.isArray(igRes.result) && igRes.result.length > 0) {
        let vCount = 0;
        let pCount = 0;
        igRes.result.forEach((item) => {
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
                quality: `High Res Photo ${mediaItems.length > 1 || igRes.result.length > 1 ? pCount : ''}`.trim(),
                size: 'Auto', format: 'JPG', url: mUrl,
                imageUrl: m.thumbnail || (typeof m !== 'string' ? mUrl : null),
                isImage: true, useProxy: true,
              });
            } else {
              vCount++;
              options.push({
                quality: `HD Video ${mediaItems.length > 1 || igRes.result.length > 1 ? vCount : ''}`.trim(),
                size: 'Auto', format: 'MP4', url: mUrl, useProxy: true,
                imageUrl: m.thumbnail || null,
              });
              options.push({
                quality: `Audio Only ${mediaItems.length > 1 || igRes.result.length > 1 ? vCount : ''}`.trim(),
                size: 'Auto', format: 'M4A', url: mUrl, isAudio: true, useProxy: true,
                imageUrl: m.thumbnail || null,
              });
              if (m.thumbnail) {
                pCount++;
                options.push({
                  quality: `High Res Photo ${mediaItems.length > 1 || igRes.result.length > 1 ? pCount : ''}`.trim(),
                  size: 'Auto', format: 'JPG', url: m.thumbnail,
                  imageUrl: m.thumbnail, isImage: true, useProxy: true,
                });
              }
            }
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
                quality: `High Res Photo ${items.length > 1 ? pCount : ''}`.trim(),
                size: 'Auto', format: 'JPG', url: mUrl, isImage: true, useProxy: true,
                imageUrl: item.thumbnail || (typeof item !== 'string' ? mUrl : null),
              });
            } else {
              vCount++;
              options.push({
                quality: `HD Video ${items.length > 1 ? vCount : ''}`.trim(),
                size: 'Auto', format: 'MP4', url: mUrl, useProxy: true,
                imageUrl: item.thumbnail || null,
              });
              options.push({
                quality: `Audio Only ${items.length > 1 ? vCount : ''}`.trim(),
                size: 'Auto', format: 'M4A', url: mUrl, isAudio: true, useProxy: true,
                imageUrl: item.thumbnail || null,
              });
              if (item.thumbnail) {
                pCount++;
                options.push({
                  quality: `High Res Photo ${items.length > 1 ? pCount : ''}`.trim(),
                  size: 'Auto', format: 'JPG', url: item.thumbnail,
                  imageUrl: item.thumbnail, isImage: true, useProxy: true,
                });
              }
            }
          });
        }
      } catch (e) {
        console.error('[Instagram] AIO fallback failed:', e.message);
      }
    }

    if (options.length > 0) {
    if (options.length > 0) {
      return {
        success: true,
        data: { type: options.every(o => o.isImage) ? 'image' : 'mixed', title: 'Instagram Post/Reel', options },
      };
    }
    }

    throw new Error('All Instagram extractors failed or no valid options were found for this URL type.');

  } catch (error) {
    console.error('[Instagram Extractor] Error:', error.message);
    return { success: false, error: error.message || 'Instagram extraction blocked.' };
  }
};

module.exports = { extractInstagram };
