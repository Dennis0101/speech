import { DateTime } from 'luxon';
import db from './db.js';
import { getLeads } from './service.js';

const KST = 'Asia/Seoul';

// 시간 문자열을 시간 수로 변환 (예: "30m" -> 0.5, "1h" -> 1)
function leadToHours(s) {
  const m = String(s).trim().match(/^(\d+)(m|h)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === 'm' ? n / 60 : n;
}

export async function scheduleJobs(client) {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  const ch = await client.channels.fetch(channelId);

  // 15분 주기로 알림 체크
  setInterval(async () => {
    try {
      const now = DateTime.utc();
      // 모니터링 범위: 지난 24h ~ 앞으로 72h
      const rows = db.prepare(`
        SELECT * FROM events
        WHERE start_utc BETWEEN ? AND ?
        ORDER BY start_utc ASC
      `).all(now.minus({hours:24}).toISO(), now.plus({hours:72}).toISO());

      const leads = getLeads(channelId); // 채널 스코프 리드 설정
      const leadHours = leads.map(leadToHours).filter(v => v !== null);

      for (const ev of rows) {
        const start = DateTime.fromISO(ev.start_utc, { zone: 'utc' });
        const kst = start.setZone(KST).toFormat('yyyy-LL-dd (ccc) HH:mm');

        // 시작 알림
        if (!ev.notified_start && now >= start && now <= start.plus({ minutes: 5 })) {
          await ch.send({
            content: '🎙️ **시작!**',
            embeds: [{
              title: `[${ev.source.toUpperCase()}] ${ev.title}`,
              url: ev.url,
              description: `일시(KST): **${kst}**\n장소: ${ev.location || 'TBD'}\n연설자: ${ev.speaker || 'TBD'}`
            }]
          });
          db.prepare(`UPDATE events SET notified_start=1 WHERE id=?`).run(ev.id);
          continue;
        }

        // 리드 알림 (예: 24h, 1h, 30m 등)
        for (const h of leadHours) {
          const mark = Math.round(h * 60); // 분 단위 키
          const col = `lead_${mark}`;
          // 동적 컬럼 없으면 생성
          db.exec(`ALTER TABLE events ADD COLUMN ${col} INTEGER DEFAULT 0`).catch(()=>{});
          const diffH = start.diff(now).as('hours');

          if (diffH <= h && diffH > h - 0.3) { // 18분 윈도우
            const already = db.prepare(`SELECT ${col} AS v FROM events WHERE id=?`).get(ev.id)?.v;
            if (!already) {
              await ch.send({
                content: `⏰ **${h >= 1 ? `${h}시간` : `${h*60}분`} 전** 알림`,
                embeds: [{
                  title: `[${ev.source.toUpperCase()}] ${ev.title}`,
                  url: ev.url,
                  description: `일시(KST): **${kst}**\n장소: ${ev.location || 'TBD'}\n연설자: ${ev.speaker || 'TBD'}`
                }]
              });
              db.prepare(`UPDATE events SET ${col}=1 WHERE id=?`).run(ev.id);
            }
          }
        }
      }
    } catch (e) {
      console.error('notify loop error:', e);
    }
  }, 15 * 60 * 1000);
}
