// src/ingestors/news.js
import RSSParser from 'rss-parser';
import { DateTime } from 'luxon';
import db from '../db.js';
import { fetchText } from '../http.js';
import { summarize } from '../llm.js'; // ⬅️ LLM 요약

const parser = new RSSParser();

/* ───────────────────────── helpers ───────────────────────── */

// Google News 링크에서 실제 기사 URL 꺼내기
function extractRealUrl(googleLink) {
  try {
    const u = new URL(googleLink);
    const real = u.searchParams.get('url');
    return real ? decodeURIComponent(real) : googleLink;
  } catch {
    return googleLink;
  }
}

// HTML → 텍스트(간단 추출)
function extractBodyFromHtml(html) {
  if (!html) return '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(header|nav|footer|aside|svg|figure|noscript|iframe)[\s\S]*?>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text.length > 200 ? text : '';
}

function upsertNews({ title, url, start_utc, sourceTag }) {
  const id = `news:${url}`;
  const payload = {
    id,
    source: sourceTag || 'news', // news / news-fed / news-cpi / news-crypto
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
      title=excluded.title,
      url=excluded.url,
      start_utc=excluded.start_utc,
      last_hash=excluded.last_hash
  `).run(payload);
}

function getQueries() {
  const env = (process.env.NEWS_QUERIES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (env.length) return env;
  // 기본 키워드 세트 (금리/FOMC/CPI/ETF/연준)
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

/* ───────────────────────── main ───────────────────────── */

/** 뉴스 수집 + 요약 생성 */
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

        // 태그 힌트
        const tag =
          /cpi|inflation/i.test(title) ? 'news-cpi' :
          /(fomc|rate|interest|fed)/i.test(title) ? 'news-fed' :
          /(bitcoin|crypto|etf|sec)/i.test(title) ? 'news-crypto' : 'news';

        // 1) 기본 upsert
        const id = `news:${link}`;
        upsertNews({ title, url: link, start_utc, sourceTag: tag });

        // 2) 이미 요약 있으면 스킵(비용 절감)
        const exists = db.prepare(
          `SELECT summary_ko, summary_en FROM events WHERE id=?`
        ).get(id);
        if (exists?.summary_ko || exists?.summary_en) continue;

        // 3) 기사 본문 가져와 요약 저장 (best-effort)
        try {
          const articleHtml = await fetchText(link);
          const body = extractBodyFromHtml(articleHtml);
          if (!body) continue;

          // ko/en 요약 생성 (원한다면 한 언어만 생성하도록 바꿔도 됨)
          const sumKo = await summarize(body, 'ko');
          const sumEn = await summarize(body, 'en');

          db.prepare(
            `UPDATE events SET summary_ko=?, summary_en=? WHERE id=?`
          ).run(sumKo || '', sumEn || '', id);
        } catch (e) {
          console.error('news summary error:', e.message);
        }
      }
    } catch (e) {
      console.error('ingestNews error:', q, e.message);
    }
  }
}
