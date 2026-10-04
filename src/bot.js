const { safeUrl, resolveDownload, resolveLink } = require("./platforms");
const { menuPage, prompts } = require("./menu");

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

async function handleUpdate(update, { telegram, resolve = resolveDownload, resolveOnly = resolveLink }) {
  const callback = update.callback_query;
  if (callback) {
    await telegram("answerCallbackQuery", { callback_query_id: callback.id });
    const page = callback.data?.startsWith("menu:") ? callback.data.slice(5) : null;
    const message = callback.message;
    if (!page || !message?.chat?.id) return;
    const base = { chat_id: message.chat.id, ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}) };
    if (prompts[page]) {
      return telegram("sendMessage", { ...base, text: prompts[page], reply_markup: { force_reply: true, input_field_placeholder: "Tempel tautan di sini…" } });
    }
    if (!["home", "help", "platforms", "resolver"].includes(page)) return;
    try {
      return await telegram("editMessageText", { ...base, message_id: message.message_id, ...menuPage(page, callback.from) });
    } catch (error) {
      if (error.message.includes("message is not modified")) return;
      return telegram("sendMessage", { ...base, ...menuPage(page, callback.from) });
    }
  }
  const message = update.message;
  if (!message || message.from?.is_bot || !message.chat?.id) return;
  const text = message.text || message.caption || "";
  let command = text.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();
  if (!command && message.reply_to_message?.from?.is_bot) {
    const prompt = message.reply_to_message.text || "";
    if (prompt === prompts.audio) command = "mp3";
    if (prompt === prompts.resolve_input) command = "resolve";
  }
  const base = { chat_id: message.chat.id, ...(message.message_thread_id ? { message_thread_id: message.message_thread_id } : {}) };
  const send = (content, extra = {}) => telegram("sendMessage", { ...base, text: content, ...extra });
  if (["start", "help", "platforms"].includes(command)) return telegram("sendMessage", { ...base, ...menuPage(command === "start" ? "home" : command, message.from) });
  if (command && !["download", "mp3", "mp4", "resolve"].includes(command)) return send("Perintah tidak dikenal. Ketik /help.");
  const url = extractUrl(message);
  if (!url) {
    if (command === "resolve") return telegram("sendMessage", { ...base, ...menuPage("resolver", message.from) });
    if (command === "download" || command === "mp3" || command === "mp4") return send(command === "mp3" ? prompts.audio : prompts.download, { reply_markup: { force_reply: true, selective: true }, reply_parameters: { message_id: message.message_id } });
    if (message.chat.type !== "private" && !command) return;
    return send("Kirim tautan lengkap, misalnya https://www.tiktok.com/@user/video/123. Ketik /help untuk bantuan.");
  }
  let progress;
  try {
    progress = await send(command === "resolve" ? "🔓 Sedang membuka tautan dan mencari tujuan akhirnya…" : "⏳ Sedang mengambil media atau membuka tautan, mohon tunggu…");
    const result = command === "resolve" ? await resolveOnly(url) : await resolve(url, command === "mp3" ? "mp3" : "mp4");
    const title = String(result.title || "Media").slice(0, 800);
    const linkOnly = result.downloads.every((item) => item.type === "link");
    const destination = result.destinationUrl || result.url || result.downloads[0].url;
    const description = `${linkOnly ? "🔓 TAUTAN BERHASIL DIBUKA" : "✅ HASIL SIAP"}\n━━━━━━━━━━━━━━━━━━━━\n${title}\n\n🌐 ${result.platform}\n⚙️ ${result.provider}${result.resolver ? `\n🔓 Via ${result.resolver}` : ""}${linkOnly ? `\n\n🔗 Tujuan:\n${destination.slice(0, 1800)}${destination === url ? "\n\nTidak ditemukan redirect; URL tetap sama." : ""}` : ""}\n\n${linkOnly ? "Ketuk tombol untuk membuka tautan tujuan." : "Pilih tombol di bawah untuk mengunduh."}`;
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
