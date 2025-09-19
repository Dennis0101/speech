// src/ingestors/cpi.js
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import db from '../db.js';
import { fetchText } from '../http.js';

function upsertEvent(evt) {
  const hash = JSON.stringify([evt.title, evt.start_utc, evt.url]);
  db.prepare(`
    INSERT INTO events (id, source, title, speaker, location, url, start_utc, last_hash)
    VALUES (@id,@source,@title,@speaker,@location,@url,@start_utc,@last_hash)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, url=excluded.url, start_utc=excluded.start_utc, last_hash=excluded.last_hash
  `).run({ ...evt, last_hash: hash });
}

/** "Month Day, Year 8:30 a.m. ET" 같은 패턴을 UTC로 */
function parseBlsDateTimeToUtc(text) {
  if (!text) return null;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/a\.m\./ig,'AM').replace(/p\.m\./ig,'PM')
    .replace(/ET\b/ig, 'America/New_York'); // 힌트

  // 일반 포맷 시도: "September 12, 2025 8:30 AM" (뉴욕 타임존)
  let dt = DateTime.fromFormat(cleaned, 'LLLL d, yyyy h:mm a', { zone: 'America/New_York' });
  if (dt.isValid) return dt.toUTC().toISO();

  // "September 12, 2025" + "8:30 AM" 분리돼 있을 수도
  const m = cleaned.match(/([A-Za-z]+ \d{1,2}, \d{4}).*?(\d{1,2}:\d{2}\s?(?:AM|PM))/i);
  if (m) {
    dt = DateTime.fromFormat(`${m[1]} ${m[2]}`, 'LLLL d, yyyy h:mm a', { zone: 'America/New_York' });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  return null;
}

/**
 * BLS CPI 일정 페이지를 파싱
 * 참고 URL(변동 가능): https://www.bls.gov/schedule/news_release/cpi.htm
 */
export async function ingestCPI() {
  const url = 'https://www.bls.gov/schedule/news_release/cpi.htm';
  const html = await fetchText(url);
  const root = parseHTML(html);

  // 날짜/시간이 들어있는 텍스트 후보를 넓게 수집
  const text = root.text.replace(/\s+/g, ' ');
  // 가장 흔한 발표 시각: 8:30 a.m. ET. 날짜 라인 근처를 정규식으로 탐색
  // 예: "Consumer Price Index ... Release Date: September 12, 2025 ... at 8:30 a.m. ET"
  const re = /(Release Date:?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}).{0,80}?(?:at\s*)?(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.)\s*ET))/i;
  const m = text.match(re);

  // 여러 개가 있을 수 있어, 보수적으로 전역 검색
  const matches = [];
  if (m) matches.push(m);
  // 보완: 날짜와 시각이 조금 떨어져 있을 때
  const reDate = /Release Date:?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/ig;
  let md;
  while ((md = reDate.exec(text)) !== null) {
    matches.push([md[0], md[0], md[1], '8:30 a.m. ET']); // 시각이 명시 없으면 기본 패턴 시도
  }

  const seen = new Set();
  for (const mm of matches) {
    const whenText = `${mm[2]} ${mm[3] || ''}`.trim(); // "September 12, 2025 8:30 a.m. ET"
    const startUtc = parseBlsDateTimeToUtc(whenText);
    if (!startUtc) continue;

    const id = `cpi:${startUtc}`;
    if (seen.has(id)) continue;
    seen.add(id);

    upsertEvent({
      id,
      source: 'cpi',
      title: 'US CPI Release',
      speaker: '',
      location: 'USA',
      url,
      start_utc: startUtc
    });
  }
}
