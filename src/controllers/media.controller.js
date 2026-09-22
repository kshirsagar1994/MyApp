let extractYouTube, extractInstagram, extractFacebook, extractSnapchat, extractLinkedIn;
let extractTikTok, extractTwitter, extractPinterest, extractThreads, extractUniversal;

try { ({ extractYouTube, extractUniversal } = require('../extractors/youtube')); }
catch (e) { console.error('[Controller] Failed to load YouTube extractor:', e.message); }

try { ({ extractInstagram } = require('../extractors/instagram')); }
catch (e) { console.error('[Controller] Failed to load Instagram extractor:', e.message); }

try { ({ extractFacebook } = require('../extractors/facebook')); }
catch (e) { console.error('[Controller] Failed to load Facebook extractor:', e.message); }

try { ({ extractSnapchat } = require('../extractors/snapchat')); }
catch (e) { console.error('[Controller] Failed to load Snapchat extractor:', e.message); }

try { ({ extractLinkedIn } = require('../extractors/linkedin')); }
catch (e) { console.error('[Controller] Failed to load LinkedIn extractor:', e.message); }

try { ({ extractTikTok } = require('../extractors/tiktok')); }
catch (e) { console.error('[Controller] Failed to load TikTok extractor:', e.message); }

try { ({ extractTwitter } = require('../extractors/twitter')); }
catch (e) { console.error('[Controller] Failed to load Twitter extractor:', e.message); }

try { ({ extractPinterest } = require('../extractors/pinterest')); }
catch (e) { console.error('[Controller] Failed to load Pinterest extractor:', e.message); }

try { ({ extractThreads } = require('../extractors/threads')); }
catch (e) { console.error('[Controller] Failed to load Threads extractor:', e.message); }

// Helper to determine the platform dynamically from the URL
const detectPlatform = (url) => {
  const u = url.toLowerCase();
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
  if (u.includes('snapchat.com')) return 'snapchat';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('reddit.com') || u.includes('redd.it')) return 'reddit';
  if (u.includes('vimeo.com')) return 'vimeo';
  if (u.includes('twitch.tv')) return 'twitch';
  if (u.includes('soundcloud.com')) return 'soundcloud';
  if (u.includes('dailymotion.com') || u.includes('dai.ly')) return 'dailymotion';
  if (u.includes('bilibili.com')) return 'bilibili';
  if (u.includes('rumble.com')) return 'rumble';
  return 'universal';
};

const analyzeUrl = async (req, res) => {
  const { url, igCookies } = req.body;

  if (!url) {
    return res.status(400).json({ status: 'error', message: 'URL is required' });
  }

  const platform = detectPlatform(url);
  let result;

  try {
    switch (platform) {
      case 'youtube':
        if (!extractYouTube) return res.status(500).json({ status: 'error', message: 'YouTube extractor is unavailable. Server configuration error.' });
        result = await extractYouTube(url, igCookies);
        break;
      case 'instagram':
        if (!extractInstagram) return res.status(500).json({ status: 'error', message: 'Instagram extractor is unavailable. Server configuration error.' });
        result = await extractInstagram(url, igCookies);
        break;
      case 'facebook':
        if (!extractFacebook) return res.status(500).json({ status: 'error', message: 'Facebook extractor is unavailable. Server configuration error.' });
        result = await extractFacebook(url, igCookies);
        break;
      case 'snapchat':
        if (!extractSnapchat) return res.status(500).json({ status: 'error', message: 'Snapchat extractor is unavailable. Server configuration error.' });
        result = await extractSnapchat(url, igCookies);
        break;
      case 'linkedin':
        if (!extractLinkedIn) return res.status(500).json({ status: 'error', message: 'LinkedIn extractor is unavailable. Server configuration error.' });
        result = await extractLinkedIn(url, igCookies);
        break;
      case 'tiktok':
        if (!extractTikTok) return res.status(500).json({ status: 'error', message: 'TikTok extractor is unavailable. Server configuration error.' });
        result = await extractTikTok(url, igCookies);
        break;
      case 'twitter':
        if (!extractTwitter) return res.status(500).json({ status: 'error', message: 'Twitter extractor is unavailable. Server configuration error.' });
        result = await extractTwitter(url, igCookies);
        break;
      case 'pinterest':
        if (!extractPinterest) return res.status(500).json({ status: 'error', message: 'Pinterest extractor is unavailable. Server configuration error.' });
        result = await extractPinterest(url, igCookies);
        break;
      case 'threads':
        if (!extractThreads) return res.status(500).json({ status: 'error', message: 'Threads extractor is unavailable. Server configuration error.' });
        result = await extractThreads(url, igCookies);
        break;
      default:
        // Universal Extractor for 1,800+ sites (Vimeo, Reddit, Twitch, SoundCloud, Dailymotion, Bilibili, etc.)
        if (extractUniversal) {
          result = await extractUniversal(url, igCookies);
        } else {
          result = { success: false, error: 'Universal extractor is unavailable.' };
        }
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
