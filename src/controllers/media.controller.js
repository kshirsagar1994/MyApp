const { extractYouTube } = require('../extractors/youtube');
const { extractInstagram } = require('../extractors/instagram');
const { extractFacebook } = require('../extractors/facebook');
const { extractSnapchat } = require('../extractors/snapchat');
const { extractLinkedIn } = require('../extractors/linkedin');

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
        result = await extractYouTube(url);
        break;
      case 'instagram':
        result = await extractInstagram(url);
        break;
      case 'facebook':
        result = await extractFacebook(url);
        break;
      case 'snapchat':
        result = await extractSnapchat(url);
        break;
      case 'linkedin':
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
    console.error('[Controller Error]', error);
    return res.status(500).json({ status: 'error', message: 'Internal Server Error during extraction.' });
  }
};

module.exports = { analyzeUrl };
