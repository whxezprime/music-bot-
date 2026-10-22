const {
  Client, GatewayIntentBits, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require('discord.js');
const { DisTube } = require('distube');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { YouTubePlugin } = require('@distube/youtube');
const fs = require('fs');
const path = require('path');

// ================= CONFIG =================
const TOKEN = process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE';
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const distube = new DisTube(client, {
  plugins: [
    new SpotifyPlugin(),
    new SoundCloudPlugin(),
    new YouTubePlugin(),
  ],
  leaveOnEmpty: true,
  leaveOnFinish: false,
  leaveOnStop: false,
});

// ========== FAVORITES ==========
const FAV_FILE = path.join(__dirname, 'favorites.json');
let favorites = {};
try {
  if (fs.existsSync(FAV_FILE)) favorites = JSON.parse(fs.readFileSync(FAV_FILE, 'utf8'));
} catch { favorites = {}; }

function saveFavorites() {
  try { fs.writeFileSync(FAV_FILE, JSON.stringify(favorites, null, 2)); }
  catch (e) { console.error('Lỗi lưu favorites:', e); }
}

// ========== UI HELPERS ==========
function buildPlayerRow(isPaused = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause')
      .setEmoji(isPaused ? '▶️' : '⏸️')
      .setLabel(isPaused ? 'Tiếp tục' : 'Tạm dừng')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setEmoji('⏭️')
      .setLabel('Bài tiếp')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_fav')
      .setEmoji('❤️')
      .setLabel('Yêu thích')
      .setStyle(ButtonStyle.Danger),
  );
}

function buildNowPlayingEmbed(song, queue) {
  return new EmbedBuilder()
    .setColor(0x1DB954)
    .setAuthor({ name: '🎶 Đang phát' })
    .setTitle((song.name || 'Không rõ').slice(0, 256))
    .setURL(song.url)
    .setDescription(`👤 Yêu cầu bởi: **${song.user}**`)
    .addFields(
      { name: '⏱️ Thời lượng', value: song.formattedDuration || 'N/A', inline: true },
      { name: '📋 Hàng đợi', value: `${queue.songs.length} bài`, inline: true },
      { name: '🔊 Âm lượng', value: `${queue.volume}%`, inline: true },
    )
    .setThumbnail(song.thumbnail || null)
    .setTimestamp();
}

// ========== SLASH COMMANDS ==========
const commands = [
  // === MỚI: /join ===
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Bot vào kênh thoại của bạn (chưa phát nhạc)'),

  new SlashCommandBuilder()
    .setName('pm')
    .setDescription('Phát nhạc từ Spotify, SoundCloud, TikTok')
    .addStringOption(o => o
      .setName('link')
      .setDescription('Dán link bài hát / playlist vào đây')
      .setRequired(true)),

  new SlashCommandBuilder()
    .setName('vol')
    .setDescription('Chỉnh âm lượng (0–200%)')
    .addIntegerOption(o => o
      .setName('level')
      .setDescription('Mức âm lượng 0–200 (mặc định 100)')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(200)),

  new SlashCommandBuilder()
    .setName('favorites')
    .setDescription('Xem danh sách bài hát yêu thích của bạn'),
].map(c => c.toJSON());

// ========== READY ==========
client.once('ready', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  try {
    await client.application.commands.set(commands);
    console.log('✅ Đã đăng ký slash commands.');
  } catch (e) { console.error('Lỗi đăng ký commands:', e); }
});

// ========== INTERACTIONS ==========
client.on('interactionCreate', async (interaction) => {
  // ---------- Slash ----------
  if (interaction.isChatInputCommand()) {

    // === MỚI: /join ===
    if (interaction.commandName === 'join') {
      const vc = interaction.member.voice.channel;
      if (!vc) {
        return interaction.reply({ content: '❌ Bạn cần vào kênh thoại trước!', ephemeral: true });
      }

      // Kiểm tra quyền của bot trong kênh thoại
      const perms = vc.permissionsFor(interaction.guild.members.me);
      if (!perms.has('Connect') || !perms.has('Speak')) {
        return interaction.reply({
          content: '❌ Bot không có quyền **Connect** hoặc **Speak** trong kênh này!',
          ephemeral: true,
        });
      }

      await interaction.deferReply();
      try {
        // Nếu đã có queue ở kênh khác → di chuyển bot sang kênh mới
        const existing = distube.getQueue(interaction.guildId);
        if (existing && existing.voiceChannel?.id !== vc.id) {
          await distube.voices.get(interaction.guild)?.moveMembers(vc.id)
            ?? await existing.voiceChannel?.members.forEach(() => {});
          // fallback: rời rồi join lại
          try {
            await distube.voices.get(interaction.guild)?.leave();
          } catch {}
        }

        await distube.voices.join(vc);

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setAuthor({ name: '🎤 Đã tham gia kênh thoại' })
          .setDescription(`Bot đã vào **${vc.name}**.\nDùng \`/pm link:...\` để phát nhạc.`)
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error(err);
        return interaction.editReply({
          content: `❌ Không thể vào kênh thoại: ${err.message?.slice(0, 500) || 'lỗi không rõ'}`,
        });
      }
    }

    if (interaction.commandName === 'pm') {
      const link = interaction.options.getString('link');
      const vc = interaction.member.voice.channel;
      if (!vc) return interaction.reply({ content: '❌ Bạn cần vào kênh thoại trước!', ephemeral: true });

      await interaction.deferReply();
      try {
        await distube.play(vc, link, { member: interaction.member, textChannel: interaction.channel });
        await interaction.editReply({ content: `🎶 Đã thêm vào hàng đợi: ${link}` });
      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: `❌ Lỗi: ${err.message?.slice(0, 1000) || 'Không thể phát nhạc'}` });
      }
      return;
    }

    if (interaction.commandName === 'vol') {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs[0]) {
        return interaction.reply({ content: '❌ Không có nhạc đang phát.', ephemeral: true });
      }
      const vc = interaction.member.voice.channel;
      if (!vc || vc.id !== queue.voiceChannel?.id) {
        return interaction.reply({ content: '❌ Bạn phải ở cùng kênh thoại với bot!', ephemeral: true });
      }

      const level = interaction.options.getInteger('level');
      try {
        await queue.setVolume(level);
        const icon = level === 0 ? '🔇' : level < 50 ? '🔈' : level <= 100 ? '🔉' : '🔊';
        return interaction.reply({ content: `${icon} Đã đặt âm lượng: **${level}%**` });
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content: `❌ Không thể đặt volume >100 trên phiên bản DisTube này.\nChi tiết: ${err.message?.slice(0, 300) || 'lỗi không rõ'}`,
          ephemeral: true,
        });
      }
    }

    if (interaction.commandName === 'favorites') {
      const list = favorites[interaction.user.id] || [];
      if (!list.length) {
        return interaction.reply({ content: '📭 Bạn chưa có bài hát yêu thích nào.', ephemeral: true });
      }
      const desc = list
        .map((s, i) => `**${i + 1}.** [${(s.name || 'Không rõ').slice(0, 80)}](${s.url})`)
        .join('\n')
        .slice(0, 4000);
      const embed = new EmbedBuilder()
        .setColor(0xFF69B4)
        .setTitle('❤️ Bài hát yêu thích của bạn')
        .setDescription(desc);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
    return;
  }

  // ---------- Buttons ----------
  if (interaction.isButton()) {
    const queue = distube.getQueue(interaction.guildId);
    if (!queue || !queue.songs[0]) {
      return interaction.reply({ content: '❌ Không có nhạc đang phát.', ephemeral: true });
    }
    const userVc = interaction.member.voice.channel;
    if (!userVc || userVc.id !== queue.voiceChannel?.id) {
      return interaction.reply({ content: '❌ Bạn phải ở cùng kênh thoại với bot!', ephemeral: true });
    }

    try {
      if (interaction.customId === 'music_pause') {
        if (queue.paused) queue.resume();
        else queue.pause();
        await interaction.update({ components: [buildPlayerRow(queue.paused)] });
      }
      else if (interaction.customId === 'music_skip') {
        const skipped = await queue.skip().catch(() => null);
        await interaction.reply({
          content: skipped ? `⏭️ Đã bỏ qua: **${skipped.name}**` : '⏭️ Đã bỏ qua bài hiện tại.',
          ephemeral: true,
        });
      }
      else if (interaction.customId === 'music_fav') {
        const song = queue.songs[0];
        if (!favorites[interaction.user.id]) favorites[interaction.user.id] = [];
        const list = favorites[interaction.user.id];
        const idx = list.findIndex(s => s.url === song.url);
        if (idx >= 0) {
          list.splice(idx, 1);
          saveFavorites();
          await interaction.reply({ content: `💔 Đã xóa khỏi yêu thích: **${song.name}**`, ephemeral: true });
        } else {
          list.push({ name: song.name, url: song.url });
          saveFavorites();
          await interaction.reply({ content: `❤️ Đã thêm vào yêu thích: **${song.name}**`, ephemeral: true });
        }
      }
    } catch (err) {
      console.error(err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Lỗi: ${err.message?.slice(0, 500)}`, ephemeral: true }).catch(() => {});
      }
    }
  }
});

// ========== DISTUBE EVENTS ==========
distube
  .on('playSong', (queue, song) => {
    queue.textChannel?.send({
      embeds: [buildNowPlayingEmbed(song, queue)],
      components: [buildPlayerRow(false)],
    }).catch(console.error);
  })
  .on('addSong', (queue, song) => {
    queue.textChannel?.send({ content: `➕ Đã thêm **${song.name}** vào hàng đợi.` }).catch(console.error);
  })
  .on('addList', (queue, playlist) => {
    queue.textChannel?.send({ content: `➕ Đã thêm playlist **${playlist.name}** (${playlist.songs.length} bài).` }).catch(console.error);
  })
  .on('empty', (queue) => {
    queue.textChannel?.send({ content: '🚪 Kênh thoại trống, bot rời đi.' }).catch(console.error);
  })
  .on('finish', (queue) => {
    queue.textChannel?.send({ content: '🏁 Đã phát xong hàng đợi.' }).catch(console.error);
  })
  .on('error', (channel, error) => {
    console.error(error);
    channel?.send(`❌ Lỗi: ${error.message?.slice(0, 1000) || 'Không rõ'}`).catch(console.error);
  });

// ========== LOGIN ==========
if (!TOKEN || TOKEN === 'YOUR_BOT_TOKEN_HERE') {
  console.error('❌ Chưa cấu hình token!');
  process.exit(1);
}
client.login(TOKEN);
