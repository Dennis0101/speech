// src/ingestors/nfp.js
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

function parseBlsDateTimeToUtc(text) {
  if (!text) return null;
  const cleaned = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/a\.m\./ig,'AM').replace(/p\.m\./ig,'PM');
  // 대부분 8:30 AM ET
  let dt = DateTime.fromFormat(cleaned, 'LLLL d, yyyy h:mm a', { zone: 'America/New_York' });
  if (dt.isValid) return dt.toUTC().toISO();

  const m = cleaned.match(/([A-Za-z]+ \d{1,2}, \d{4}).*?(\d{1,2}:\d{2}\s?(AM|PM))/i);
  if (m) {
    dt = DateTime.fromFormat(`${m[1]} ${m[2]}`, 'LLLL d, yyyy h:mm a', { zone: 'America/New_York' });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  return null;
}

/**
 * BLS Employment Situation (NFP) 일정
 * https://www.bls.gov/schedule/news_release/empsit.htm
 */
export async function ingestNFP() {
  const url = 'https://www.bls.gov/schedule/news_release/empsit.htm';
  const html = await fetchText(url);
  const root = parseHTML(html);

  const text = root.text.replace(/\s+/g, ' ');
  // "Release Date: Month Day, Year ... 8:30 a.m. ET"
  const re = /(Release Date:?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4}).{0,80}?(?:at\s*)?(\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.)\s*ET))/i;
  const m = text.match(re);

  const matches = [];
  if (m) matches.push(m);

  const reDate = /Release Date:?\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/ig;
  let md;
  while ((md = reDate.exec(text)) !== null) {
    matches.push([md[0], md[0], md[1], '8:30 a.m. ET']);
  }

  const seen = new Set();
  for (const mm of matches) {
    const whenText = `${mm[2]} ${mm[3] || ''}`.trim();
    const startUtc = parseBlsDateTimeToUtc(whenText);
    if (!startUtc) continue;

    const id = `nfp:${startUtc}`;
    if (seen.has(id)) continue;
    seen.add(id);

    upsertEvent({
      id,
      source: 'nfp',
      title: 'US Nonfarm Payrolls (Employment Situation)',
      speaker: '',
      location: 'USA',
      url,
      start_utc: startUtc
    });
  }
}
