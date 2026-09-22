const videoId = 'dQw4w9WgXcQ';
const url = `https://www.youtube.com/watch?v=${videoId}`;

async function testFreeApis() {
  // 1. VKRDown API
  try {
    const res = await fetch(`https://api.vkrdown.com/api/yt?url=${encodeURIComponent(url)}`);
    console.log('[vkrdown] status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('[vkrdown] data:', data);
    }
  } catch(e) { console.log('[vkrdown] err:', e.message); }

  // 2. Loader.to
  try {
    const res = await fetch(`https://loader.to/ajax/download.php?format=1080&url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('[loader.to] status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('[loader.to] data:', data);
    }
  } catch(e) { console.log('[loader.to] err:', e.message); }

  // 3. ddownr.com
  try {
    const res = await fetch(`https://ddownr.com/api/create?url=${encodeURIComponent(url)}&format=1080`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('[ddownr] status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('[ddownr] data:', data);
    }
  } catch(e) { console.log('[ddownr] err:', e.message); }

  // 4. yt-download.org iframe
  try {
    const res = await fetch(`https://yt-download.org/api/button/videos/${videoId}`);
    console.log('[yt-download.org] status:', res.status);
    if (res.ok) {
      const html = await res.text();
      console.log('[yt-download.org] html length:', html.length);
    }
  } catch(e) { console.log('[yt-download.org] err:', e.message); }
}

testFreeApis();
