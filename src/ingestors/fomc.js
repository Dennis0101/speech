// src/ingestors/fomc.js
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

/**
 * "Month d–d, yyyy" 혹은 "Month d, yyyy" 문구를 UTC로 변환
 * 시간 정보가 없으면 스킵 (정확도 우선)
 */
function parseFomcDateTimeRangeToUtc(text) {
  if (!text) return null;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // 흔한 포맷: "September 17–18, 2025"
  let m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})(?:–|-|to)\s*(\d{1,2}),\s*(\d{4})/);
  if (m) {
    // 결정문 발표는 보통 둘째 날 오후(ET)지만, 정확 시각 명시 없으면 스킵
    return null;
  }
  // "September 18, 2025 14:00 ET" 같은 텍스트가 있을 때만 파싱
  m = cleaned.match(/([A-Za-z]+ \d{1,2}, \d{4}).{0,50}?(\d{1,2}:\d{2})\s?(AM|PM)\s?ET/i);
  if (m) {
    const dt = DateTime.fromFormat(`${m[1]} ${m[2]} ${m[3]}`, 'LLLL d, yyyy hh:mm a', {
      zone: 'America/New_York'
    });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  return null;
}

/**
 * FOMC 캘린더(결정/회의) 페이지 파싱
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 */
export async function ingestFOMC() {
  const url = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
  const html = await fetchText(url);
  const root = parseHTML(html);

  // 페이지에서 회의 블록 텍스트 수집
  const blocks = root.querySelectorAll('section, article, li, p, div');
  const seen = new Set();

  for (const node of blocks) {
    const txt = node.text.replace(/\s+/g, ' ').trim();
    if (!/FOMC|Meeting|Statement|Press Conference/i.test(txt)) continue;

    const startUtc = parseFomcDateTimeRangeToUtc(txt);
    if (!startUtc) continue; // 시각 불명확 → 스킵

    const id = `fomc:${startUtc}`;
    if (seen.has(id)) continue;
    seen.add(id);

    upsertEvent({
      id,
      source: 'fomc',
      title: 'FOMC Statement/Decision',
      speaker: '',
      location: 'USA',
      url,
      start_utc: startUtc
    });
  }
}
