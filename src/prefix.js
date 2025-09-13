import { DateTime } from 'luxon';
import { getUpcomingEvents, setLeads, subscribe, unsubscribe, listSubscriptions } from './service.js';
import { getTimelineChartUrlForNextDays } from './timeline.js'; // ⬅️ 추가

const KST = 'Asia/Seoul';

export async function handlePrefixCommand({ client, msg, cmd, args }) {
  if (cmd === 'help') {
    return msg.reply([
      '**명령어**',
      '`!next [시간]` — 앞으로 N시간(기본 48) 일정',
      '`!sub <fed|ecb|boe|all>` — 채널 구독',
      '`!unsub <fed|ecb|boe|all>` — 채널 구독 해제',
      '`!alerts <리드들>` — 알림 리드 설정 (예: `!alerts 30m 1h 24h`)',
      '`!subs` — 이 채널 구독 목록',
      '`!timeline [일수]` — 다가오는 일정 타임라인 이미지(기본 7일, 최대 14일)', // ⬅️ 추가
      '`!help`'
    ].join('\n'));
  }

  if (cmd === 'next') {
    const hours = Number(args[0]) || 48;
    const subs = listSubscriptions(msg.channelId);
    const sources = subs.length ? subs : []; // 구독 없으면 전체 보여주기
    const events = getUpcomingEvents(hours, sources);
    if (!events.length) return msg.reply('예정된 일정이 없어요.');

    const lines = events.slice(0, 8).map(ev => {
      const kst = DateTime.fromISO(ev.start_utc, { zone: 'utc' }).setZone(KST).toFormat('MM-dd (ccc) HH:mm');
      return `• [${(ev.source || '').toUpperCase()}] **${ev.title}** — ${kst} KST`;
    });

    return msg.reply(lines.join('\n'));
  }

  if (cmd === 'subs') {
    const subs = listSubscriptions(msg.channelId);
    return msg.reply(subs.length ? `구독중: \`${subs.join(', ')}\`` : '구독 없음. `!sub fed|ecb|boe|all`');
  }

  if (cmd === 'sub') {
    const t = (args[0] || '').toLowerCase();
    if (!['fed','ecb','boe','all'].includes(t)) {
      return msg.reply('사용법: `!sub fed|ecb|boe|all`');
    }
    subscribe(msg.channelId, t);
    return msg.reply(`✅ 구독 완료: **${t.toUpperCase()}**`);
  }

  if (cmd === 'unsub') {
    const t = (args[0] || '').toLowerCase();
    if (!['fed','ecb','boe','all'].includes(t)) {
      return msg.reply('사용법: `!unsub fed|ecb|boe|all`');
    }
    unsubscribe(msg.channelId, t);
    return msg.reply(`✅ 구독 해제: **${t.toUpperCase()}**`);
  }

  if (cmd === 'alerts') {
    const leads = args.length ? args : ['1h','24h'];
    setLeads(msg.channelId, leads);
    return msg.reply(`⏰ 알림 리드: \`${leads.join(', ')}\``);
  }

  // ⬇️ 새로 추가: 타임라인 이미지
  if (cmd === 'timeline') {
    const days = Math.min(Math.max(Number(args[0]) || 7, 1), 14); // 1~14일 제한 (URL 과도 길이 방지)
    const url = getTimelineChartUrlForNextDays(days);
    if (!url) return msg.reply('표시할 일정이 없어요. 먼저 `!sub fed|ecb|boe|all`로 구독하고 데이터가 쌓였는지 확인해보세요.');
    return msg.reply({
      content: `🗓️ 다가오는 ${days}일 타임라인`,
      embeds: [{ title: `Upcoming ${days} Days (KST)`, image: { url } }]
    });
  }

  return msg.reply('명령을 찾지 못했어요. `!help`를 입력해보세요.');
}
