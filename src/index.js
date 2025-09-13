import { Client, GatewayIntentBits, Partials } from 'discord.js';
import 'dotenv/config';
import { scheduleJobs } from './scheduler.js';
import { handlePrefixCommand } from './prefix.js';
import { ingestFed } from './ingestors/fed.js';

// 프리픽스 명령어 즉시 사용 (슬래시 불필요)
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // ✅ 프리픽스 명령에 필요
  ],
  partials: [Partials.Channel]
});

const PREFIX = process.env.PREFIX || '!';

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // 부팅 시 1회 수집
  try {
    await ingestFed();
    console.log('Fed ingest done.');
  } catch (e) {
    console.error('Fed ingest error:', e);
  }
  // 스케줄 루프 시작(알림)
  scheduleJobs(client);

  // 수집 주기(30분) – 필요 시 조정
  setInterval(async () => {
    try { await ingestFed(); } catch (e) { console.error('ingestFed loop error:', e); }
  }, 30 * 60 * 1000);
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  try {
    await handlePrefixCommand({ client, msg, cmd: cmd.toLowerCase(), args });
  } catch (e) {
    console.error(e);
    msg.reply('⚠️ 명령 처리 중 오류가 발생했어요.');
  }
});

client.login(process.env.DISCORD_TOKEN);
