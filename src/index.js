import { Client, GatewayIntentBits, Partials } from 'discord.js';
import 'dotenv/config';
import { scheduleJobs } from './scheduler.js';
import { handlePrefixCommand } from './prefix.js';
import { setupPanel } from './panel.js';
// 인제스터
import { ingestFed } from './ingestors/fed.js';
import { ingestECB } from './ingestors/ecb.js';
import { ingestBoE } from './ingestors/boe.js';
import { ingestNews } from './ingestors/news.js';
import { ingestCPI } from './ingestors/cpi.js';
import { ingestNFP } from './ingestors/nfp.js';
import { ingestFOMC } from './ingestors/fomc.js';


const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const PREFIX = process.env.PREFIX || '!';

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  if (!process.env.DISCORD_CHANNEL_ID) {
    console.warn('⚠️ DISCORD_CHANNEL_ID 가 설정되지 않았습니다. 알림이 전송되지 않을 수 있어요.');
  }

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

  scheduleJobs(client);

  setInterval(async () => {
    try {
      await ingestFed();
      await ingestECB();
      await ingestBoE();
      await ingestNews();
      await ingestCPI();
      await ingestNFP();
      await ingestFOMC();
    } catch (e) {
      console.error('ingestor loop error:', e);
    }
  }, 30 * 60 * 1000);

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

// 패널 기능 초기화
setupPanel(client);

client.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('UncaughtException:', err));
