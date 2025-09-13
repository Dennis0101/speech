// src/ingestors/boe.js
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

function parseUKTimeToUtc(text) {
  if (!text) return null;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  // ISO 우선
  let dt = DateTime.fromISO(cleaned, { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // 예: "15 September 2025 10:00 BST"/"GMT"
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy HH:mm ZZZ', { setZone: true });
  if (dt.isValid) return dt.toUTC().toISO();

  // 예: "Monday, 15 September 2025 10:00" (타임존 표기 없음 → 런던 가정)
  dt = DateTime.fromFormat(cleaned, 'cccc, d LLLL yyyy HH:mm', { zone: 'Europe/London' });
  if (dt.isValid) return dt.toUTC().toISO();

  // 날짜만 있을 때 00:00 런던 가정
  dt = DateTime.fromFormat(cleaned, 'd LLLL yyyy', { zone: 'Europe/London' }).set({ hour: 0, minute: 0 });
  if (dt.isValid) return dt.toUTC().toISO();

  return null;
}

// 상세 페이지에서 시각/연사 보강
async function enrichFromDetail(urlEv) {
  try {
    const detail = await fetchText(urlEv);
    const droot = parseHTML(detail);
    const whenText =
      droot.querySelector('time[datetime]')?.getAttribute?.('datetime') ||
      droot.querySelector('time')?.text?.trim() ||
      droot.querySelector('.date, .published-date, .event-date, .datetime')?.text?.trim() ||
      '';
    const start_utc = parseUKTimeToUtc(whenText);

    const speaker =
      droot.querySelector('.speaker, .author, .byline')?.text?.replace(/\s+/g, ' ')?.trim() || '';

    return { start_utc, speaker };
  } catch {
    return { start_utc: null, speaker: '' };
  }
}

export async function ingestBoE() {
  // BoE 연설/이벤트 목록(영문)
  const url = 'https://www.bankofengland.co.uk/speeches';
  const html = await fetchText(url);
  const root = parseHTML(html);

  // 카드/목록 요소(보수적으로 여러 선택자 시도)
  const items = [
    ...root.querySelectorAll('article, .teaser, .boe-card, li')
  ];

  const seen = new Set();

  for (const node of items) {
    const a = node.querySelector('a');
    const rawTitle = (a?.text || node.querySelector('h3, h2')?.text || '').replace(/\s+/g, ' ').trim();
    const title = rawTitle?.length ? rawTitle : '';
    if (!title) continue;

    let link = a?.getAttribute?.('href') || '';
    if (link.startsWith('/')) link = `https://www.bankofengland.co.uk${link}`;
    const urlEv = link || url;

    // 시간 후보
    let whenText =
      node.querySelector('time[datetime]')?.getAttribute?.('datetime') ||
      node.querySelector('time')?.text?.trim() ||
      node.querySelector('.date, .published-date, .event-date, .datetime')?.text?.trim() ||
      '';

    let startUtc = parseUKTimeToUtc(whenText);
    let speaker = '';

    // 상세 페이지에서 보강
    if ((!startUtc || !speaker) && urlEv && urlEv !== url) {
      const detail = await enrichFromDetail(urlEv);
      startUtc = detail.start_utc || startUtc;
      speaker = detail.speaker || speaker;
    }

    if (!startUtc) continue; // 시각 없으면 스킵 (정확도 우선)

    // 제목에서 연사 힌트: "Speech by Andrew Bailey at ..."
    if (!speaker) {
      const m = title.match(/by (.+?) (?:at|on|in)\b/i) || title.match(/by (.+)$/i);
      if (m) speaker = m[1].trim();
    }

    const id = `boe:${urlEv}`;
    if (seen.has(id)) continue;
    seen.add(id);

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
