import { Client, GatewayIntentBits, Partials } from 'discord.js';
import 'dotenv/config';
import { scheduleJobs } from './scheduler.js';
import { handlePrefixCommand } from './prefix.js';

// 인제스터
import { ingestFed } from './ingestors/fed.js';
import { ingestECB } from './ingestors/ecb.js';
import { ingestBoE } from './ingestors/boe.js';
import { ingestNews } from './ingestors/news.js';
import { ingestCPI } from './ingestors/cpi.js';
import { ingestNFP } from './ingestors/nfp.js';
import { ingestFOMC } from './ingestors/fomc.js';

// 프리픽스 명령어 즉시 사용 (슬래시 불필요)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // ✅ 프리픽스 명령어에 필요
  ],
  partials: [Partials.Channel]
});

const PREFIX = process.env.PREFIX || '!';

// v15 대비: ready → clientReady (DeprecationWarning 제거)
client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // 환경 점검
  if (!process.env.DISCORD_CHANNEL_ID) {
    console.warn('⚠️ DISCORD_CHANNEL_ID 가 설정되지 않았습니다. 알림이 전송되지 않을 수 있어요.');
  }

  // 부팅 시 1회 수집
  try {
    await ingestFed();
    await ingestECB();
    await ingestBoE();
    await ingestNews();
    await ingestCPI();
    await ingestNFP();
    await ingestFOMC();
    console.log('Fed/ECB/BoE/News/CPI/NFP/FOMC ingest done.');
  } catch (e) {
    console.error('Ingest error (boot):', e);
  }

  // 스케줄 루프 시작(알림)
  scheduleJobs(client);

  // 중앙은행/정기 수집 루프 (30분)
  setInterval(async () => {
    try {
      await ingestFed();
      await ingestECB();
      await ingestBoE();
      await ingestNews(); // 백업용으로 30분 루프에도 포함
      await ingestCPI();
      await ingestNFP();
      await ingestFOMC();
    } catch (e) {
      console.error('ingestor loop error:', e);
    }
  }, 30 * 60 * 1000);

  // 뉴스 전용 짧은 루프 (기본 5분)
  const newsMin = Math.max(1, Number(process.env.NEWS_POLL_MIN || 5));
  setInterval(async () => {
    try {
      await ingestNews();
    } catch (e) {
      console.error('ingestNews short loop error:', e);
    }
  }, newsMin * 60 * 1000);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  try {
    await handlePrefixCommand({ client, msg, cmd: cmd.toLowerCase(), args });
  } catch (e) {
    console.error('command error:', e);
    msg.reply('⚠️ 명령 처리 중 오류가 발생했어요.');
  }
});

client.login(process.env.DISCORD_TOKEN);

// (옵션) 예외 로깅 보강
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
