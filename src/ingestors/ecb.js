// src/ingestors/ecb.js
import fetch from 'node-fetch';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import db from '../db.js';

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

/**
 * 문자열에서 날짜시각 파싱 시도.
 * 가능한 포맷 예시:
 *  - "Monday, 15 September 2025 10:00 CET"
 *  - "15 September 2025 10:00 CET"
 *  - "2025-09-15T10:00+02:00"
 */
function parseWhenToUtc(whenText) {
  if (!whenText) return null;
  const cleaned = whenText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // ISO 먼저
  let dt = DateTime.fromISO(cleaned);
  if (dt.isValid) return dt.toUTC().toISO();

  // “15 September 2025 10:00 CET/CEST”
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // “Monday, 15 September 2025 10:00 CET”
  dt = DateTime.fromFormat(cleaned, 'cccc, d LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // 날짜만 있을 때는 00:00 브뤼셀로 가정
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy', { zone: 'Europe/Brussels' }).set({ hour: 0, minute: 0 });
  if (dt.isValid) return dt.toUTC().toISO();

  return null;
}

export async function ingestECB() {
  // ECB 주간 캘린더(영문)
  const url = 'https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html';
  const html = await (await fetch(url)).text();
  const root = parseHTML(html);

  // 이벤트 블록(보수적으로 선택자 여러개 시도)
  const candidates = [
    ...root.querySelectorAll('.event, .ecb-cal-event, .calendar-event, li, article')
  ];

  // 중복 방지용 set
  const seen = new Set();

  for (const node of candidates) {
    // 제목
    const h = node.querySelector('h3, h2, .title, .eventTitle, a');
    const title = (h?.text || '').replace(/\s+/g, ' ').trim();
    if (!title || /calendar|week/i.test(title)) continue;

    // 링크
    let link = h?.getAttribute?.('href') || node.querySelector('a')?.getAttribute?.('href');
    if (link && link.startsWith('/')) link = `https://www.ecb.europa.eu${link}`;
    const urlEv = link || url;

    // 시간 찾기: <time> 또는 주변 텍스트
    let whenText =
      node.querySelector('time')?.getAttribute?.('datetime') ||
      node.querySelector('time')?.text?.trim() ||
      node.querySelector('.eventDate, .date, .datetime')?.text?.trim() ||
      '';

    let startUtc = parseWhenToUtc(whenText);
    if (!startUtc) {
      // 주변 텍스트에서도 한 번 더 시도
      const txt = node.text.replace(/\s+/g, ' ').trim();
      startUtc = parseWhenToUtc(txt);
    }
    if (!startUtc) continue; // 시간 없으면 스킵 (정확도 위해)

    const id = `ecb:${urlEv}`;
    if (seen.has(id)) continue;
    seen.add(id);

    upsertEvent({
      id,
      source: 'ecb',
      title,
      speaker: '',            // 필요 시 상세 페이지 파싱으로 확장
      location: 'EU',
      url: urlEv,
      start_utc: startUtc
    });
  }
}
