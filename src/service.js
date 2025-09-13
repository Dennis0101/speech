import db from './db.js';

export function getLeads(scopeId) {
  const row = db.prepare(`SELECT leads FROM settings WHERE scope_id=?`).get(scopeId);
  if (!row) return ['1h', '24h'];
  try { return JSON.parse(row.leads) || ['1h','24h']; } catch { return ['1h','24h']; }
}

export function setLeads(scopeId, leads) {
  const payload = JSON.stringify(leads);
  db.prepare(`
    INSERT INTO settings(scope_id, leads)
    VALUES (?, ?)
    ON CONFLICT(scope_id) DO UPDATE SET leads=excluded.leads
  `).run(scopeId, payload);
}

/* -------------------- 언어 설정 추가 -------------------- */

export function getLang(scopeId) {
  const row = db.prepare(`SELECT lang FROM settings WHERE scope_id=?`).get(scopeId);
  return row?.lang || 'mixed'; // mixed | ko | en
}

export function setLang(scopeId, lang) {
  const allowed = ['mixed', 'ko', 'en'];
  const val = allowed.includes(lang) ? lang : 'mixed';
  // 기존 leads가 있으면 보존, 없으면 기본 ["1h","24h"]로 채움
  const currentLeads =
    db.prepare(`SELECT leads FROM settings WHERE scope_id=?`).get(scopeId)?.leads ||
    JSON.stringify(['1h','24h']);

  db.prepare(`
    INSERT INTO settings(scope_id, leads, lang)
    VALUES (?, ?, ?)
    ON CONFLICT(scope_id) DO UPDATE SET lang=excluded.lang
  `).run(scopeId, currentLeads, val);
}

/* -------------------- 구독 관련 -------------------- */

export function subscribe(scopeId, source) {
  if (source === 'all') {
    ['fed','ecb','boe'].forEach(s => db.prepare(
      `INSERT OR IGNORE INTO subscriptions(scope_id, source) VALUES(?,?)`
    ).run(scopeId, s));
    return;
  }
  db.prepare(`INSERT OR IGNORE INTO subscriptions(scope_id, source) VALUES(?,?)`).run(scopeId, source);
}

export function unsubscribe(scopeId, source) {
  if (source === 'all') {
    db.prepare(`DELETE FROM subscriptions WHERE scope_id=?`).run(scopeId);
    return;
  }
  db.prepare(`DELETE FROM subscriptions WHERE scope_id=? AND source=?`).run(scopeId, source);
}

export function listSubscriptions(scopeId) {
  const rows = db.prepare(`SELECT source FROM subscriptions WHERE scope_id=?`).all(scopeId);
  return rows.map(r => r.source);
}

/* -------------------- 이벤트 조회 -------------------- */

export function getUpcomingEvents(hours = 48, sources = []) {
  const now = new Date().toISOString();
  const upper = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  let sql = `SELECT * FROM events WHERE start_utc BETWEEN ? AND ?`;
  const params = [now, upper];
  if (sources.length) {
    sql += ` AND source IN (${sources.map(()=>'?').join(',')})`;
    params.push(...sources);
  }
  sql += ` ORDER BY start_utc ASC`;
  return db.prepare(sql).all(...params);
}
