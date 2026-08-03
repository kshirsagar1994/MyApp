const { ytdlpGetInfoAsync } = require('./youtube');

/**
 * Extracts Threads media.
 * Uses yt-dlp as PRIMARY.
 */
const extractThreads = async (url, igCookies = null) => {
  try {
    const options = [];

    console.log('[Threads] PRIMARY: yt-dlp extraction...');
    const info = await ytdlpGetInfoAsync(url, [], 25000, igCookies);

    const title = info.title || 'Threads Media';
    const thumbnail = info.thumbnail || '';
    
    const formats = info.formats || [];
    const directUrl = info.url;

    if (formats.length > 0) {
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
    
    // Check if it's just an image
    if (info.thumbnails && info.thumbnails.length > 0) {
       const bestImage = info.thumbnails[info.thumbnails.length - 1];
       options.push({
         quality: 'Image (HD)', size: 'Auto', format: 'JPG', url: bestImage.url, isImage: true
       });
       return { success: true, data: { type: 'image', title, thumbnail: bestImage.url, options } };
    }

  } catch (err) {
    console.error('[Threads] Fatal error:', err.message);
  }

  return { success: false, error: 'Threads extraction failed. Check if the link is correct.' };
};

module.exports = { extractThreads };
