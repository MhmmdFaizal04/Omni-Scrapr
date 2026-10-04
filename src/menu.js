const { platforms } = require("./platforms");

const commands = [
  { command: "start", description: "🏠 Menu utama" },
  { command: "download", description: "📥 Unduh media dari tautan" },
  { command: "resolve", description: "🔓 Buka shortlink dan tautan tujuan" },
  { command: "mp3", description: "🎧 Audio YouTube" },
  { command: "mp4", description: "🎬 Video YouTube" },
  { command: "platforms", description: "🌐 Platform yang didukung" },
  { command: "help", description: "💡 Panduan penggunaan" },
];

const prompts = {
  download: "📥 DOWNLOAD MEDIA\n\nBalas pesan ini dengan satu tautan media publik. Saya akan mengambil video, foto, atau audio secara otomatis.",
  audio: "🎧 AUDIO YOUTUBE\n\nBalas pesan ini dengan tautan YouTube untuk mendapatkan MP3.",
  resolve_input: "🔓 RESOLVER TAUTAN\n\nBalas pesan ini dengan shortlink, Safelinku, Sub2Unlock, Rekonise, MediaFire, atau Sfile. Saya akan menampilkan tautan tujuan.",
};

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const button = (text, page) => ({ text, callback_data: `menu:${page}` });
const homeKeyboard = { inline_keyboard: [
  [button("📥 Download media", "download"), button("🎧 YouTube MP3", "audio")],
  [button("🔓 Resolver tautan", "resolver"), button("🌐 Platform", "platforms")],
  [button("💡 Cara pakai", "help")],
] };

function menuPage(page = "home", user = {}) {
  const media = platforms.filter((p) => p.kind !== "resolver");
  const resolvers = platforms.filter((p) => p.kind === "resolver");
  const back = [[button("‹ Menu utama", "home")]];
  let text;
  let keyboard = { inline_keyboard: back };
  if (page === "platforms") {
    text = `🌐 <b>PLATFORM TERSEDIA</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>📥 Media · ${media.length} platform</b>\n${media.map((p) => `• ${escapeHtml(p.name)}`).join("\n")}\n\n<b>🔓 Resolver · ${resolvers.length} layanan</b>\n${resolvers.map((p) => `• ${escapeHtml(p.name)}`).join("\n")}\n\nKirim tautan langsung untuk deteksi otomatis.`;
    keyboard = { inline_keyboard: [[button("🔓 Buka resolver", "resolver")], ...back] };
  } else if (page === "resolver") {
    text = `🔓 <b>LINK RESOLVER</b>\n━━━━━━━━━━━━━━━━━━━━\n\nLewati rantai tautan dan temukan tujuan akhirnya.\n\n<b>Layanan:</b>\n${resolvers.map((p) => `• ${escapeHtml(p.name)}`).join("\n")}\n\n<b>Hanya buka tautan:</b>\n<code>/resolve https://bit.ly/...</code>\n\n<b>Buka lalu unduh:</b>\nKirim tautan resolver langsung. Jika tujuannya platform yang didukung, saya lanjut mengambil medianya.\n\nUnshorten mendukung redirect HTTP dan meta-refresh; tidak semua shortlink berbasis JavaScript/captcha dapat dibuka.`;
    keyboard = { inline_keyboard: [[button("🔗 Masukkan tautan", "resolve_input")], ...back] };
  } else if (page === "help") {
    text = "💡 <b>CARA PAKAI</b>\n━━━━━━━━━━━━━━━━━━━━\n\n<b>1.</b> Salin tautan media atau shortlink.\n<b>2.</b> Kirim ke chat ini, atau pilih fitur di menu.\n<b>3.</b> Tunggu hasil, lalu gunakan tombol unduh.\n\n📥 <code>/download &lt;tautan&gt;</code> — unduh otomatis\n🔓 <code>/resolve &lt;tautan&gt;</code> — lihat tujuan tautan\n🎧 <code>/mp3 &lt;tautan YouTube&gt;</code> — audio\n🎬 <code>/mp4 &lt;tautan YouTube&gt;</code> — video\n🌐 /platforms — daftar layanan\n🏠 /start — kembali ke menu\n\nSatu tautan per pesan. Album/playlist menampilkan hingga 8 tombol dan satu media utama. Gunakan tautan publik.";
  } else {
    const name = escapeHtml(String(user.first_name || "teman").slice(0, 80));
    text = `⚡ <b>OMNI-SCRAPR</b>\n<i>Media downloader &amp; link resolver</i>\n━━━━━━━━━━━━━━━━━━━━\n\nHalo, <b>${name}</b>! 👋\nTautan masuk, media siap diunduh.\n\n📥 <b>Video · Foto · Musik</b>\n🔓 <b>Shortlink · Unlock · Direct link</b>\n🌐 <b>${media.length} platform media + ${resolvers.length} resolver</b>\n\nKirim tautan langsung atau pilih fitur di bawah. 👇`;
    keyboard = homeKeyboard;
  }
  return { text, parse_mode: "HTML", reply_markup: keyboard, link_preview_options: { is_disabled: true } };
}

module.exports = { menuPage, prompts, commands, escapeHtml };
