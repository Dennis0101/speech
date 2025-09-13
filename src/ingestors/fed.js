import RSSParser from 'rss-parser';
import fetch from 'node-fetch';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import db from '../db.js';

const parser = new RSSParser();

// ISO 또는 텍스트에서 시간 추출 시도 → UTC ISO 반환 (실패 시 null)
async function extractStartUtcFromPage(url) {
  try {
    const html = await (await fetch(url)).text();
    const root = parseHTML(html);

    // 1) <time datetime="..."> 우선 사용
    const t = root.querySelector('time[datetime]');
    if (t?.getAttribute('datetime')) {
      const iso = t.getAttribute('datetime'); // e.g., "2025-09-01T10:00-04:00"
      const dt = DateTime.fromISO(iso);
      if (dt.isValid) return dt.toUTC().toISO();
    }

    // 2) 메타/헤더의 날짜 텍스트를 포맷 추정 파싱 (동부시간 가정)
    const candidates = [
      root.querySelector('.lastUpdate')?.text?.trim(),
      root.querySelector('.article__time')?.text?.trim(),
      root.querySelector('h2 + p')?.text?.trim(),
    ].filter(Boolean);

    for (const cand of candidates) {
      // 예: "September 1, 2025 10:00 a.m. ET" 등 변형
      const cleaned = cand.replace(/\u00a0/g, ' ').replace(/(a\.m\.|p\.m\.)/gi, s => s.replace(/\./g, ''));
      // 시도 1
      let dt = DateTime.fromFormat(cleaned, 'LLLL d, yyyy h:mm a ZZZ', { zone: 'America/New_York' });
      if (dt.isValid) return dt.toUTC().toISO();
      // 시도 2 (시간이 없을 때 00:00)
      dt = DateTime.fromFormat(cleaned, 'LLLL d, yyyy', { zone: 'America/New_York' }).set({ hour: 0, minute: 0 });
      if (dt.isValid) return dt.toUTC().toISO();
    }
  } catch (_) {
    // 무시하고 null
  }
  return null;
}

function upsertEvent(evt) {
  const hash = JSON.stringify([evt.title, evt.start_utc, evt.url]);
  db.prepare(`
    INSERT INTO events (id, source, title, speaker, location, url, start_utc, last_hash)
    VALUES (@id,@source,@title,@speaker,@location,@url,@start_utc,@last_hash)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, speaker=excluded.speaker, location=excluded.location,
      url=excluded.url, start_utc=excluded.start_utc, last_hash=excluded.last_hash
  `).run({ ...evt, last_hash: hash });
}

// Fed 연설 RSS 크롤링
export async function ingestFed() {
  const feed = await parser.parseURL('https://www.federalreserve.gov/feeds/speeches.xml');
  for (const item of feed.items) {
    const url = item.link;
    const title = (item.title || 'Federal Reserve Speech').trim();

    // 연설 시각을 본문에서 최대한 추출
    let startUtc = await extractStartUtcFromPage(url);

    // 그래도 실패하면 RSS pubDate 기반(근사치) — 알림 품질 위해 너무 과거/미래는 제외
    if (!startUtc && item.pubDate) {
      const dt = DateTime.fromJSDate(new Date(item.pubDate)).toUTC();
      if (dt.isValid) startUtc = dt.toISO();
    }
    if (!startUtc) continue; // 시간이 없으면 패스 (정확도 확보)

    // speaker 추출 힌트
    const m = title.match(/by (.+)$/i);
    const speaker = m ? m[1].trim() : '';

    upsertEvent({
      id: `fed:${url}`,
      source: 'fed',
      title,
      speaker,
      location: 'USA',
      url,
      start_utc: startUtc
    });
  }
}
