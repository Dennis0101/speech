import Database from 'better-sqlite3';

const db = new Database('events.db');

// 스키마: 이벤트, 구독(채널/유저 단위), 설정
db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT,
  title TEXT,
  speaker TEXT,
  location TEXT,
  url TEXT,
  start_utc TEXT,
  last_hash TEXT,
  notified_24h INTEGER DEFAULT 0,
  notified_1h INTEGER DEFAULT 0,
  notified_start INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_utc);

CREATE TABLE IF NOT EXISTS subscriptions (
  scope_id TEXT,            -- 채널ID 또는 유저ID (여기선 채널 기준 사용)
  source TEXT,              -- fed|ecb|boe|all
  PRIMARY KEY(scope_id, source)
);

CREATE TABLE IF NOT EXISTS settings (
  scope_id TEXT PRIMARY KEY,
  leads TEXT                 -- JSON 배열 문자열 e.g. ["1h","24h"]
);
`);

export default db;
