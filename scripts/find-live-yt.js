const videoId = 'dQw4w9WgXcQ';
const url = `https://www.youtube.com/watch?v=${videoId}`;

async function testLiveEndpoints() {
  console.log('--- Testing Invidious Instances ---');
  const invInstances = [
    'https://invidious.nerdvpn.de',
    'https://inv.nadeko.net',
    'https://invidious.protokolla.fi',
    'https://inv.vern.cc',
    'https://invidious.einfachzocken.eu',
    'https://invidious.no-logs.com',
    'https://invidious.slipfox.xyz',
    'https://invidious.projectsegfau.lt',
    'https://yt.artemislena.eu',
    'https://invidious.privacydev.net',
  ];

  for (const inst of invInstances) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${inst}/api/v1/videos/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: controller.signal
      });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        console.log(`[Invidious SUCCESS] ${inst} -> Title: ${data.title}, Formats: ${data.formatStreams?.length}`);
      } else {
        console.log(`[Invidious FAIL] ${inst} -> Status ${res.status}`);
      }
    } catch(e) {
      console.log(`[Invidious ERR] ${inst} -> ${e.message}`);
    }
  }

  console.log('\n--- Testing Cobalt Instances ---');
  const cobaltInstances = [
    'https://api.cobalt.tools',
    'https://cobalt.kwiatekm.com',
    'https://cobalt-api.kellr.club',
    'https://api.wuk.sh',
    'https://co.wuk.sh',
  ];

  for (const c of cobaltInstances) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${c}/api/json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify({ url, vQuality: '1080' }),
        signal: controller.signal
      });
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json();
        console.log(`[Cobalt SUCCESS] ${c} -> status: ${data.status}, url: ${data.url ? data.url.substring(0, 50) : 'picker'}`);
      } else {
        console.log(`[Cobalt FAIL] ${c} -> Status ${res.status}`);
      }
    } catch(e) {
      console.log(`[Cobalt ERR] ${c} -> ${e.message}`);
    }
  }
}

testLiveEndpoints();
