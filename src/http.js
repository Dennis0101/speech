import fetch from 'node-fetch';

// 기본 타임아웃(ms)
const DEFAULT_TIMEOUT = Number(process.env.HTTP_TIMEOUT || 15000);

/**
 * fetchText: URL을 가져와 text() 반환
 * - Accept / User-Agent 헤더 기본 제공
 * - 타임아웃 적용
 * - 실패 시 상태코드 + 일부 body를 포함한 에러 throw
 */
export async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const res = await fetch(url, {
      headers: {
        // 최대한 관대한 Accept
        'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        // 서버들이 좋아하는 UA
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
        // 일부 사이트가 언어 헤더 요구
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} ${res.statusText} — ${url}\n${t.slice(0, 200)}`
      );
    }

    return res.text();
  } catch (err) {
    // fetch / abort 에러 로깅
    console.error(`fetchText error: ${url}`, err.message);
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
