const test = require("node:test");
const assert = require("node:assert/strict");
const { detectPlatform, normalizeDownloads, resolveDownload } = require("../src/platforms");
const { extractUrl, handleUpdate } = require("../src/bot");
const { createWebhook } = require("../src/webhook");
const { createTelegram } = require("../src/telegram");

test("deteksi domain asli, subdomain, dan penolakan domain tiruan", () => {
  assert.equal(detectPlatform("https://vm.tiktok.com/abc").name, "TikTok");
  assert.equal(detectPlatform("https://youtu.be/abcdefghijk").name, "YouTube");
  assert.equal(detectPlatform("https://tiktok.com.evil.test/abc"), null);
  assert.equal(detectPlatform("https://eviltiktok.com/abc"), null);
  assert.equal(detectPlatform("https://user:pass@tiktok.com/abc"), null);
  assert.equal(detectPlatform("file:///etc/passwd"), null);
});

test("URL Telegram mendukung entity UTF-16, text_link, dan caption", () => {
  const text = "🎵 https://youtu.be/abcdefghijk";
  assert.equal(extractUrl({ text, entities: [{ type: "url", offset: 3, length: text.length - 3 }] }), "https://youtu.be/abcdefghijk");
  assert.equal(extractUrl({ text: "klik", entities: [{ type: "text_link", url: "https://x.com/a/status/1" }] }), "https://x.com/a/status/1");
  assert.equal(extractUrl({ caption: "Unduh (https://youtu.be/abcdefghijk)." }), "https://youtu.be/abcdefghijk");
});

test("normalisasi tipe provider, deduplikasi, dan URL tidak valid", () => {
  const downloads = normalizeDownloads({ downloads: [
    { type: "MP3 (128kbps)", url: "https://cdn.test/song" },
    { type: "audio", url: "https://cdn.test/song" },
    { type: "mp4", url: "https://cdn.test/movie" },
    { type: "video", url: "https://cdn.test/stream.m3u8" },
    { type: "image", url: "javascript:alert(1)" },
  ] });
  assert.deepEqual(downloads.map((item) => item.type), ["audio", "video", "file"]);
});

test("provider fallback berjalan setelah gagal dan hasil kosong", async () => {
  const calls = [];
  const platform = { name: "Test", providers: [
    { name: "failed", scrape: async () => { calls.push(1); throw new Error("network"); } },
    { name: "empty", scrape: async () => { calls.push(2); return { status: true, result: { downloads: [] } }; } },
    { name: "works", scrape: async () => { calls.push(3); return { status: true, result: { downloads: [{ type: "mp4", url: "https://cdn.test/file" }] } }; } },
  ] };
  const result = await resolveDownload("https://example.test", "mp4", { platform });
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.provider, "works");
  assert.equal(result.downloads[0].type, "video");
});

test("provider macet dibatasi timeout dan provider berikutnya dipakai", async () => {
  const platform = { name: "Test", providers: [
    { name: "hang", scrape: () => new Promise(() => {}) },
    { name: "works", scrape: async () => ({ status: true, result: { downloads: [{ url: "https://cdn.test/file" }] } }) },
  ] };
  const result = await resolveDownload("https://example.test", "mp4", { platform, providerTimeout: 10 });
  assert.equal(result.provider, "works");
});

function telegramMock(failMedia = false) {
  const calls = [];
  return { calls, telegram: async (method, payload) => {
    calls.push({ method, payload });
    if (failMedia && method === "sendAudio") throw new Error("Telegram sendAudio: file too large");
    return { message_id: 42 };
  } };
}

test("perintah MP3 mengirim audio dan tombol unduh, fallback jika Telegram menolak", async () => {
  const mock = telegramMock(true);
  let format;
  await handleUpdate({ message: { text: "/mp3 https://youtu.be/abcdefghijk", chat: { id: 7, type: "private" } } }, {
    telegram: mock.telegram,
    resolve: async (_, value) => {
      format = value;
      return { title: "Lagu", platform: "YouTube", provider: "mock", downloads: [{ type: "audio", url: "https://cdn.test/song", quality: "128kbps" }] };
    },
  });
  assert.equal(format, "mp3");
  assert.deepEqual(mock.calls.map((call) => call.method), ["sendMessage", "editMessageText", "sendAudio", "sendMessage"]);
  assert.equal(mock.calls[1].payload.reply_markup.inline_keyboard[0][0].url, "https://cdn.test/song");
  assert.match(mock.calls[3].payload.text, /tombol unduh/);
});

test("kesalahan resolver ditampilkan dengan mengedit pesan progres", async () => {
  const mock = telegramMock();
  await handleUpdate({ message: { text: "https://unsupported.test", chat: { id: 7 } } }, {
    telegram: mock.telegram,
    resolve: async () => { throw new Error("Platform belum didukung"); },
  });
  assert.equal(mock.calls[1].payload.text, "Platform belum didukung");
});

test("pesan grup tanpa tautan dan pesan dari bot diabaikan", async () => {
  const mock = telegramMock();
  await handleUpdate({ message: { text: "halo", chat: { id: 7, type: "group" } } }, mock);
  await handleUpdate({ message: { text: "/start", from: { is_bot: true }, chat: { id: 7 } } }, mock);
  assert.equal(mock.calls.length, 0);
});

function responseMock() {
  return { code: null, data: null, headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(data) { this.data = data; return this; },
  };
}

test("webhook menolak metode, konfigurasi kosong, secret salah, dan JSON rusak", () => {
  const handler = createWebhook({ waitUntil: () => assert.fail("must not process"), processUpdate: () => {}, env: { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_WEBHOOK_SECRET: "secret" } });
  for (const [req, status] of [
    [{ method: "GET", headers: {} }, 405],
    [{ method: "POST", headers: {}, body: { update_id: 1 } }, 401],
    [{ method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret" }, body: "{" }, 400],
    [{ method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret" }, body: {} }, 400],
  ]) {
    const res = responseMock();
    handler(req, res);
    assert.equal(res.code, status);
  }
  const res = responseMock();
  createWebhook({ env: {} })({ method: "POST" }, res);
  assert.equal(res.code, 503);
});

test("webhook memberi ACK sebelum pekerjaan selesai dan dedup retry instance", async () => {
  const jobs = [];
  let processed = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const handler = createWebhook({
    env: { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_WEBHOOK_SECRET: "secret" },
    waitUntil: (job) => jobs.push(job),
    processUpdate: async () => { processed++; await gate; },
  });
  const req = { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret" }, body: { update_id: 5 } };
  const res = responseMock();
  handler(req, res);
  handler(req, responseMock());
  assert.equal(res.code, 200);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(jobs.length, 1);
  await Promise.resolve();
  assert.equal(processed, 1);
  release();
  await Promise.all(jobs);
});

test("Telegram API mengirim JSON dan tidak membocorkan token saat koneksi gagal", async () => {
  const telegram = createTelegram("secret-token", async (url, options) => {
    assert.equal(url, "https://api.telegram.org/botsecret-token/sendMessage");
    assert.deepEqual(JSON.parse(options.body), { chat_id: 1, text: "halo" });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 9 } }) };
  });
  assert.deepEqual(await telegram("sendMessage", { chat_id: 1, text: "halo" }), { message_id: 9 });
  const broken = createTelegram("secret-token", async () => { throw new Error("https://api.telegram.org/botsecret-token/sendMessage"); });
  await assert.rejects(broken("sendMessage"), (error) => !error.message.includes("secret-token"));
});
