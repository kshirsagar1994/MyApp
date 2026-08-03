const { withTimeout, ytdlpGetInfoAsync } = require('./youtube');

// GUARD: btch-downloader may not be available in all environments
let btch;
try { btch = require('btch-downloader'); } catch { btch = null; }

/**
 * Extracts TikTok media.
 * Uses yt-dlp as PRIMARY, btch ttdl as FALLBACK.
 */
const extractTikTok = async (url, igCookies = null) => {
  try {
    const options = [];

    // 1. PRIMARY: yt-dlp
    try {
      console.log('[TikTok] PRIMARY: yt-dlp extraction...');
      const info = await ytdlpGetInfoAsync(url, [], 25000, igCookies);

      const title = info.title || 'TikTok Media';
      const thumbnail = info.thumbnail || '';
      
      const formats = info.formats || [];
      const directUrl = info.url;

      if (formats.length > 0) {
        // Find a video format with watermarked and unwatermarked options if possible
        let added = 0;
        formats.forEach(f => {
          if (f.vcodec !== 'none' && f.url && f.protocol === 'https') {
            options.push({
              quality: `${f.format_note || f.format_id || 'HD'} (${f.resolution || f.ext})`,
              size: f.filesize ? `${(f.filesize / 1024 / 1024).toFixed(2)} MB` : 'Auto',
              format: f.ext.toUpperCase(),
              url: f.url,
              isVideo: true,
            });
            added++;
          }
        });

        if (added > 0) {
          // Deduplicate based on quality and URL
          const uniqueOptions = Array.from(new Map(options.map(item => [item.quality, item])).values());
          return { success: true, data: { type: 'video', title, thumbnail, options: uniqueOptions } };
        }
      }

      if (directUrl) {
        options.push({
          quality: 'Video (HD)', size: 'Auto', format: 'MP4', url: directUrl, isVideo: true
        });
        return { success: true, data: { type: 'video', title, thumbnail, options } };
      }
    } catch (ytErr) {
      console.error('[TikTok] yt-dlp failed:', ytErr.message);
    }

    // 2. FALLBACK: btch-downloader (ttdl)
    if (btch && btch.ttdl) {
      console.log('[TikTok] FALLBACK: btch-downloader ttdl...');
      try {
        const fallbackRes = await withTimeout(btch.ttdl(url), 20000, 'btch.ttdl');
        if (fallbackRes && (fallbackRes.video || fallbackRes.audio)) {
          const title = fallbackRes.title || 'TikTok Media';
          const thumbnail = fallbackRes.thumbnail || '';
          
          if (fallbackRes.video && fallbackRes.video.length > 0) {
            fallbackRes.video.forEach((v, index) => {
               options.push({
                 quality: v === fallbackRes.video_nowm ? 'No Watermark' : `Video ${index + 1}`,
                 size: 'Auto', format: 'MP4', url: v, isVideo: true
               });
            });
          }
          if (fallbackRes.audio && fallbackRes.audio.length > 0) {
             fallbackRes.audio.forEach((a, index) => {
               options.push({
                 quality: `Audio ${index + 1}`, size: 'Auto', format: 'MP3', url: a, isAudio: true
               });
             });
          }
          return { success: true, data: { type: 'video', title, thumbnail, options } };
        }
      } catch (ttErr) {
         console.error('[TikTok] btch.ttdl fallback failed:', ttErr.message);
      }
    }
  } catch (err) {
    console.error('[TikTok] Fatal error:', err.message);
  }

  return { success: false, error: 'TikTok extraction failed. Check if the link is correct.' };
};

module.exports = { extractTikTok };
