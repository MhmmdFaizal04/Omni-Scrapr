const { platforms, safeUrl, resolveDownload } = require("./platforms");

const HELP = [
  "Halo! Kirim tautan media publik untuk mendapatkan media dan tombol unduh.",
  "",
  "/download <tautan> — unduh otomatis",
  "/mp3 <tautan YouTube> — audio YouTube",
  "/mp4 <tautan YouTube> — video YouTube",
  "/platforms — daftar platform",
  "/help — bantuan",
  "",
  "Satu tautan per pesan. Untuk album/playlist, tombol unduh menampilkan hingga 8 hasil; bot mengirim satu media utama.",
].join("\n");

function extractUrl(message) {
  const text = message.text || message.caption || "";
  for (const entity of message.entities || message.caption_entities || []) {
    const value = entity.type === "text_link" ? entity.url : entity.type === "url" ? text.slice(entity.offset, entity.offset + entity.length) : null;
    if (value && safeUrl(value)) return value;
  }
  const match = text.match(/https?:\/\/[^\s<>]+/i);
  const value = match?.[0].replace(/[),.!?;]+$/, "");
  return value && safeUrl(value) ? value : null;
}

function buildKeyboard(downloads) {
  return { inline_keyboard: downloads.slice(0, 8).map((item, index) => [{
    text: `${index + 1}. ${item.type} ${item.quality || item.filename || "Unduh"}`.slice(0, 60),
    url: item.url,
  }]) };
}

async function handleUpdate(update, { telegram, resolve = resolveDownload }) {
  const message = update.message;
  if (!message || message.from?.is_bot || !message.chat?.id) return;
  const text = message.text || message.caption || "";
  const command = text.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();
  const base = { chat_id: message.chat.id, ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}) };
  const send = (content, extra = {}) => telegram("sendMessage", { ...base, text: content, ...extra });
  if (command === "start" || command === "help") return send(HELP);
  if (command === "platforms") return send(`Platform tersedia:\n${platforms.map((p) => `• ${p.name}`).join("\n")}\n\nKetersediaan media bergantung pada provider dan akses publik.`);
  if (command && !["download", "mp3", "mp4"].includes(command)) return send("Perintah tidak dikenal. Ketik /help.");
  const url = extractUrl(message);
  if (!url) {
    if (message.chat.type !== "private" && !command) return;
    return send("Kirim tautan lengkap, misalnya https://www.tiktok.com/@user/video/123. Ketik /help untuk bantuan.");
  }
  let progress;
  try {
    progress = await send("Sedang mengambil media, mohon tunggu…");
    const result = await resolve(url, command === "mp3" ? "mp3" : "mp4");
    const title = String(result.title || "Media").slice(0, 800);
    const description = `${title}\n\nPlatform: ${result.platform}\nProvider: ${result.provider}\nPilih tombol di bawah untuk mengunduh.`;
    const keyboard = buildKeyboard(result.downloads);
    await telegram("editMessageText", { ...base, message_id: progress.message_id, text: description, reply_markup: keyboard, link_preview_options: { is_disabled: true } });
    const primary = result.downloads.find((item) => item.type === (command === "mp3" ? "audio" : "video"))
      || result.downloads.find((item) => item.type === "audio")
      || result.downloads.find((item) => item.type === "image");
    if (primary) {
      const method = { video: "sendVideo", audio: "sendAudio", image: "sendPhoto" }[primary.type];
      const field = { video: "video", audio: "audio", image: "photo" }[primary.type];
      try {
        await telegram(method, { ...base, [field]: primary.url, caption: title, ...(primary.type === "video" ? { supports_streaming: true } : {}) });
      } catch {
        await send("Telegram tidak dapat mengirim media ini langsung. Gunakan tombol unduh di atas (ukuran atau akses URL mungkin tidak didukung Telegram).");
      }
    }
  } catch (error) {
    const text = error.message.startsWith("Telegram ") ? "Terjadi kendala saat mengirim hasil. Coba lagi nanti." : error.message;
    if (progress) {
      try {
        await telegram("editMessageText", { ...base, message_id: progress.message_id, text });
        return;
      } catch { /* Pesan mungkin sudah tidak dapat diedit. */ }
    }
    await send(text);
  }
}

module.exports = { handleUpdate, extractUrl, buildKeyboard };
