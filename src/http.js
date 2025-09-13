import fetch from 'node-fetch';

export async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      // 최대한 관대한 Accept
      'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      // 서버들이 좋아하는 UA
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      // 일부 사이트가 언어 헤더 요구
      'Accept-Language': 'en-US,en;q=0.9'
    },
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}\n${t.slice(0,200)}`);
  }
  return res.text();
}
