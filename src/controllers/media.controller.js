// GUARD: Each extractor is wrapped in try/catch so a single broken module
// doesn't crash the entire server (e.g., if btch-downloader has a dep issue).
let extractYouTube, extractInstagram, extractFacebook, extractSnapchat, extractLinkedIn;

try { ({ extractYouTube } = require('../extractors/youtube')); }
catch (e) { console.error('[Controller] Failed to load YouTube extractor:', e.message); }

try { ({ extractInstagram } = require('../extractors/instagram')); }
catch (e) { console.error('[Controller] Failed to load Instagram extractor:', e.message); }

try { ({ extractFacebook } = require('../extractors/facebook')); }
catch (e) { console.error('[Controller] Failed to load Facebook extractor:', e.message); }

try { ({ extractSnapchat } = require('../extractors/snapchat')); }
catch (e) { console.error('[Controller] Failed to load Snapchat extractor:', e.message); }

try { ({ extractLinkedIn } = require('../extractors/linkedin')); }
catch (e) { console.error('[Controller] Failed to load LinkedIn extractor:', e.message); }

// Helper to determine the platform dynamically from the URL
const detectPlatform = (url) => {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('snapchat.com')) return 'snapchat';
  if (u.includes('linkedin.com')) return 'linkedin';
  return 'unknown';
};

const analyzeUrl = async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', message: 'URL is required' });
  }

  const platform = detectPlatform(url);
  let result;

  try {
    switch (platform) {
      case 'youtube':
        if (!extractYouTube) return res.status(500).json({ status: 'error', message: 'YouTube extractor is unavailable. Server configuration error.' });
        result = await extractYouTube(url);
        break;
      case 'instagram':
        if (!extractInstagram) return res.status(500).json({ status: 'error', message: 'Instagram extractor is unavailable. Server configuration error.' });
        result = await extractInstagram(url);
        break;
      case 'facebook':
        if (!extractFacebook) return res.status(500).json({ status: 'error', message: 'Facebook extractor is unavailable. Server configuration error.' });
        result = await extractFacebook(url);
        break;
      case 'snapchat':
        if (!extractSnapchat) return res.status(500).json({ status: 'error', message: 'Snapchat extractor is unavailable. Server configuration error.' });
        result = await extractSnapchat(url);
        break;
      case 'linkedin':
        if (!extractLinkedIn) return res.status(500).json({ status: 'error', message: 'LinkedIn extractor is unavailable. Server configuration error.' });
        result = await extractLinkedIn(url);
        break;
      default:
        result = { success: false, error: `Unsupported platform. Supported: YouTube, Instagram, Facebook, Snapchat, LinkedIn.` };
    }

    if (!result.success) {
      // Cleanly pass scraper rejection messages directly back to the React Native app
      return res.status(400).json({ status: 'error', message: result.error });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        platform,
        ...result.data,
      },
    });

  } catch (error) {
    console.error(`[Controller Error] [${platform}]`, error);
    return res.status(500).json({ status: 'error', message: `Internal Server Error during ${platform} extraction.` });
  }
};

module.exports = { analyzeUrl };
