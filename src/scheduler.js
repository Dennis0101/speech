// src/scheduler.js
import { DateTime } from 'luxon';
import db from './db.js';
import { getLeads, getLang } from './service.js'; // ⬅️ 언어 설정도 반영

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
      `).all(now.minus({ hours: 24 }).toISO(), now.plus({ hours: 72 }).toISO());

      const leads = getLeads(channelId); // 채널 스코프 리드 설정
      const leadHours = leads.map(leadToHours).filter(v => v !== null);
      const lang = getLang(channelId);   // mixed | ko | en

      for (const ev of rows) {
        const start = DateTime.fromISO(ev.start_utc, { zone: 'utc' });
        const kst = start.setZone(KST).toFormat('yyyy-LL-dd (ccc) HH:mm');
        const source = String(ev.source || '').toUpperCase();
        const isNews = String(ev.source || '').startsWith('news');

        // 시작 알림 (뉴스는 즉시성 강화를 위해 윈도우 60분으로 확대)
        const windowMin = isNews ? 60 : 5;
        if (!ev.notified_start && now >= start && now <= start.plus({ minutes: windowMin })) {
          let desc;
          if (isNews) {
            // 뉴스 요약 붙이기
            let summaryText = '';
            if (lang === 'ko' && ev.summary_ko) summaryText = ev.summary_ko;
            else if (lang === 'en' && ev.summary_en) summaryText = ev.summary_en;
            else if (lang === 'mixed') {
              if (ev.summary_ko) summaryText += `🇰🇷 ${ev.summary_ko}\n`;
              if (ev.summary_en) summaryText += `🇺🇸 ${ev.summary_en}`;
            }

            desc = `시각(KST): **${kst}**\n링크: ${ev.url}`;
            if (summaryText) desc += `\n\n📌 요약:\n${summaryText}`;
          } else {
            desc = `일시(KST): **${kst}**\n장소: ${ev.location || 'TBD'}\n연설자: ${ev.speaker || 'TBD'}`;
          }

          await ch.send({
            content: isNews ? '⚡ **속보!**' : '🎙️ **시작!**',
            embeds: [{
              title: `[${source}] ${ev.title}`,
              url: ev.url,
              description: desc
            }]
          });
          db.prepare(`UPDATE events SET notified_start=1 WHERE id=?`).run(ev.id);
          continue;
        }

        // 리드 알림 (예: 24h, 1h, 30m 등) — 뉴스에는 적용하지 않음
        if (isNews) continue;

        for (const h of leadHours) {
          const mark = Math.round(h * 60); // 분 단위 키
          const col = `lead_${mark}`;
          // 동적 컬럼 없으면 생성 (있으면 무시)
          try {
            db.exec(`ALTER TABLE events ADD COLUMN ${col} INTEGER DEFAULT 0`);
          } catch (_) {}
          const diffH = start.diff(now).as('hours');

          if (diffH <= h && diffH > h - 0.3) { // 약 18분 윈도우
            const already = db.prepare(`SELECT ${col} AS v FROM events WHERE id=?`).get(ev.id)?.v;
            if (!already) {
              await ch.send({
                content: `⏰ **${h >= 1 ? `${h}시간` : `${h * 60}분`} 전** 알림`,
                embeds: [{
                  title: `[${source}] ${ev.title}`,
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
