// src/ingestors/news.js
import RSSParser from 'rss-parser';
import { DateTime } from 'luxon';
import db from '../db.js';
import { fetchText } from '../http.js'; // 너의 http.js에 있는 UA/Accept 헤더 달린 fetch

const parser = new RSSParser();

// Google News 링크에서 실제 기사 URL 꺼내기 (있으면)
function extractRealUrl(googleLink) {
  try {
    const u = new URL(googleLink);
    const real = u.searchParams.get('url');
    return real ? decodeURIComponent(real) : googleLink;
  } catch {
    return googleLink;
  }
}

function upsertNews({ title, url, start_utc, sourceTag }) {
  const id = `news:${url}`;
  const payload = {
    id,
    source: sourceTag || 'news',      // news / news-fed / news-cpi 등 원하면 태그 세분화 가능
    title,
    speaker: '',
    location: 'USA',
    url,
    start_utc,
    last_hash: JSON.stringify([title, start_utc, url])
  };
  db.prepare(`
    INSERT INTO events (id, source, title, speaker, location, url, start_utc, last_hash)
    VALUES (@id,@source,@title,@speaker,@location,@url,@start_utc,@last_hash)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, url=excluded.url, start_utc=excluded.start_utc, last_hash=excluded.last_hash
  `).run(payload);
}

function getQueries() {
  const env = (process.env.NEWS_QUERIES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (env.length) return env;
  // 기본 키워드 세트 (금리/FOMC/CPI/ETF)
  return [
    'Fed interest rate',
    'FOMC statement',
    'US CPI inflation',
    'SEC bitcoin ETF'
  ];
}

async function fetchGoogleNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const xml = await fetchText(url);
  return parser.parseString(xml);
}

/** 뉴스 수집: Google News RSS 기반 */
export async function ingestNews() {
  const queries = getQueries();
  for (const q of queries) {
    try {
      const feed = await fetchGoogleNews(q);
      for (const item of feed.items || []) {
        const rawLink = item.link || '';
        const link = extractRealUrl(rawLink);
        const title = (item.title || '').trim();
        const pub = item.isoDate || item.pubDate || new Date().toISOString();
        const dt = DateTime.fromJSDate(new Date(pub)).toUTC();
        const start_utc = dt.isValid ? dt.toISO() : new Date().toISOString();
        if (!title || !link) continue;

        // 태그 힌트 (선택)
        const tag =
          /cpi|inflation/i.test(title) ? 'news-cpi' :
          /fomc|rate|interest/i.test(title) ? 'news-fed' :
          /bitcoin|etf|sec/i.test(title) ? 'news-crypto' : 'news';

        upsertNews({ title, url: link, start_utc, sourceTag: tag });
      }
    } catch (e) {
      console.error('ingestNews error:', q, e.message);
    }
  }
}
