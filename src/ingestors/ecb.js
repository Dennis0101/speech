// src/ingestors/ecb.js
import fetch from 'node-fetch';
import { parse as parseHTML } from 'node-html-parser';
import { DateTime } from 'luxon';
import db from '../db.js';

// ---- 공통 유틸: 헤더 지정 fetch (406 회피) ----
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}\n${body.slice(0,200)}`);
  }
  return res.text();
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

/**
 * 문자열에서 날짜·시각 파싱 시도 → UTC ISO
 * 예시:
 *  - "Monday, 15 September 2025 10:00 CET"
 *  - "15 September 2025 10:00 CEST"
 *  - "2025-09-15T10:00+02:00"
 */
function parseWhenToUtc(whenText) {
  if (!whenText) return null;
  const cleaned = whenText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // ISO 우선
  let dt = DateTime.fromISO(cleaned, { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // “15 September 2025 10:00 CET/CEST”
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // “Monday, 15 September 2025 10:00 CET”
  dt = DateTime.fromFormat(cleaned, 'cccc, d LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // “15 September 2025”
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy', { zone: 'Europe/Brussels' }).set({ hour: 0, minute: 0 });
  if (dt.isValid) return dt.toUTC().toISO();

  return null;
}

// 상세 페이지에서 시간·연사 보강 시도
async function enrichFromDetail(urlEv) {
  try {
    const html = await fetchText(urlEv);
    const root = parseHTML(html);

    const timeIso =
      root.querySelector('time[datetime]')?.getAttribute?.('datetime') ||
      root.querySelector('time')?.text?.trim() ||
      root.querySelector('.date, .eventDate, .published, .datetime')?.text?.trim() ||
      '';

    const start_utc = parseWhenToUtc(timeIso);

    // 연사 힌트(있을 때만)
    const speaker =
      root.querySelector('.speaker, .author, .byline')?.text?.replace(/\s+/g, ' ')?.trim() || '';

    return { start_utc, speaker };
  } catch {
    return { start_utc: null, speaker: '' };
  }
}

export async function ingestECB() {
  const url = 'https://www.ecb.europa.eu/press/calendars/weekly/html/index.en.html';

  const html = await fetchText(url);
  const root = parseHTML(html);

  // 이벤트 블록(보수적으로 여러 선택자 시도)
  const candidates = [
    ...root.querySelectorAll('.event, .ecb-cal-event, .calendar-event, li, article')
  ];

  const seen = new Set();

  for (const node of candidates) {
    // 제목
    const h = node.querySelector('h3, h2, .title, .eventTitle, a');
    const rawTitle = (h?.text || '').replace(/\s+/g, ' ').trim();
    const title = rawTitle?.length ? rawTitle : '';

    // 잡다한 캘린더 섹션/내비게이션 제외
    if (!title || /calendar|week(?:ly)?|download|subscribe/i.test(title)) continue;

    // 링크
    let link = h?.getAttribute?.('href') || node.querySelector('a')?.getAttribute?.('href') || '';
    if (link.startsWith('/')) link = `https://www.ecb.europa.eu${link}`;
    const urlEv = link || url;

    // 시간: time 태그 → 텍스트 → 상세 페이지
    let whenText =
      node.querySelector('time[datetime]')?.getAttribute?.('datetime') ||
      node.querySelector('time')?.text?.trim() ||
      node.querySelector('.eventDate, .date, .datetime')?.text?.trim() ||
      '';

    let startUtc = parseWhenToUtc(whenText);
    let speaker = '';

    if (!startUtc) {
      // 주변 텍스트에서도 재시도
      const txt = node.text.replace(/\s+/g, ' ').trim();
      startUtc = parseWhenToUtc(txt);
    }

    // 그래도 없으면 상세 페이지에서 보강
    if (!startUtc && urlEv && urlEv !== url) {
      const detail = await enrichFromDetail(urlEv);
      startUtc = detail.start_utc || startUtc;
      speaker = detail.speaker || speaker;
    }

    if (!startUtc) continue; // 시간 없으면 스킵 (정확도 우선)

    const id = `ecb:${urlEv}`;
    if (seen.has(id)) continue;
    seen.add(id);

    upsertEvent({
      id,
      source: 'ecb',
      title,
      speaker,
      location: 'EU',
      url: urlEv,
      start_utc: startUtc
    });
  }
}
