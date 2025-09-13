// src/ingestors/boe.js
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

function parseUKTimeToUtc(text) {
  if (!text) return null;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // ISO 우선
  let dt = DateTime.fromISO(cleaned);
  if (dt.isValid) return dt.toUTC().toISO();

  // 예: "15 September 2025 10:00 BST"/"GMT"
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // 예: "Monday, 15 September 2025 10:00"
  dt = DateTime.fromFormat(cleaned, 'cccc, d LLLL yyyy HH:mm', { zone: 'Europe/London' });
  if (dt.isValid) return dt.toUTC().toISO();

  // 날짜만 있을 때 00:00 런던 가정
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy', { zone: 'Europe/London' }).set({ hour: 0, minute: 0 });
  if (dt.isValid) return dt.toUTC().toISO();

  return null;
}

export async function ingestBoE() {
  // BoE 연설/이벤트 목록(영문) – speeches 페이지가 가장 지속적으로 유지됨
  const url = 'https://www.bankofengland.co.uk/speeches';
  const html = await (await fetch(url)).text();
  const root = parseHTML(html);

  // 카드/목록 요소(보수적으로 여러 선택자 시도)
  const items = [
    ...root.querySelectorAll('article, .teaser, .boe-card, li')
  ];

  const seen = new Set();

  for (const node of items) {
    const a = node.querySelector('a');
    const title = (a?.text || node.querySelector('h3, h2')?.text || '').replace(/\s+/g, ' ').trim();
    if (!title) continue;

    let link = a?.getAttribute?.('href');
    if (link && link.startsWith('/')) link = `https://www.bankofengland.co.uk${link}`;
    const urlEv = link || url;

    // 시간 후보
    let whenText =
      node.querySelector('time')?.getAttribute?.('datetime') ||
      node.querySelector('time')?.text?.trim() ||
      node.querySelector('.date, .published-date, .event-date')?.text?.trim() ||
      '';

    // 상세 페이지 한 번 더 시도 (필요시)
    if (!whenText && urlEv && urlEv !== url) {
      try {
        const detail = await (await fetch(urlEv)).text();
        const droot = parseHTML(detail);
        whenText =
          droot.querySelector('time')?.getAttribute?.('datetime') ||
          droot.querySelector('time')?.text?.trim() ||
          droot.querySelector('.date, .published-date, .event-date')?.text?.trim() ||
          '';
      } catch (_) {}
    }

    const startUtc = parseUKTimeToUtc(whenText);
    if (!startUtc) continue; // 시각 없으면 스킵

    const id = `boe:${urlEv}`;
    if (seen.has(id)) continue;
    seen.add(id);

    // 종종 제목에 연사 이름이 포함: "Speech by Andrew Bailey at ..."
    const m = title.match(/by (.+?) at/i);
    const speaker = m ? m[1].trim() : '';

    upsertEvent({
      id,
      source: 'boe',
      title,
      speaker,
      location: 'UK',
      url: urlEv,
      start_utc: startUtc
    });
  }
}
