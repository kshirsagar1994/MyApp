const rapidApiKey = 'f4240838c3msh284fd4a41d1ee47p1bae2djsn6eaf70cd1663';
const videoId = 'dQw4w9WgXcQ';
const url = `https://www.youtube.com/watch?v=${videoId}`;

async function testRapidYt() {
  const endpoints = [
    {
      host: 'yt-api.p.rapidapi.com',
      url: `https://yt-api.p.rapidapi.com/dl?id=${videoId}`,
    },
    {
      host: 'youtube-video-fast-downloader.p.rapidapi.com',
      url: `https://youtube-video-fast-downloader.p.rapidapi.com/index?url=${encodeURIComponent(url)}`,
    },
    {
      host: 'social-media-video-downloader.p.rapidapi.com',
      url: `https://social-media-video-downloader.p.rapidapi.com/smvd/get/youtube?url=${encodeURIComponent(url)}`,
    },
    {
      host: 'youtube-media-downloader.p.rapidapi.com',
      url: `https://youtube-media-downloader.p.rapidapi.com/v2/video/details?videoId=${videoId}`,
    }
  ];

  for (const ep of endpoints) {
    try {
      console.log('Testing RapidAPI:', ep.host);
      const res = await fetch(ep.url, {
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': ep.host
        }
      });
      console.log(`[${ep.host}] status:`, res.status);
      if (res.ok) {
        const text = await res.text();
        console.log(`[${ep.host}] response snippet:`, text.substring(0, 300));
      }
    } catch(e) {
      console.log(`[${ep.host}] error:`, e.message);
    }
  }
}

testRapidYt();
