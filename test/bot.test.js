const test = require("node:test");
const assert = require("node:assert/strict");
const { detectPlatform, normalizeDownloads, resolveDownload, resolveLink } = require("../src/platforms");
const { extractUrl, handleUpdate } = require("../src/bot");
const { createWebhook } = require("../src/webhook");
const { createTelegram } = require("../src/telegram");
const { menuPage, prompts } = require("../src/menu");
const { validatePublicUrl, isPublicAddress } = require("../src/public-url");
const { createServer } = require("node:http");
const { once } = require("node:events");
const unshorten = require("../lib/resolver/unshorten").scrape;

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

test("semua resolver library terdaftar dan tipe link tetap dipertahankan", () => {
  for (const [url, name] of [
    ["https://safelinku.com/abc", "Safelinku"],
    ["https://sub2unlock.net/abc", "Sub2Unlock"],
    ["https://rekonise.com/abc", "Rekonise"],
    ["https://bit.ly/abc", "Unshorten"],
    ["https://mediafire.com/file/abc", "MediaFire"],
    ["https://sfile.co/abc", "Sfile"],
  ]) {
    const platform = detectPlatform(url);
    assert.equal(platform.name, name);
    assert.equal(platform.kind, "resolver");
  }
  assert.equal(normalizeDownloads({ downloads: [{ type: "link", url: "https://example.com" }] })[0].type, "link");
});

function resolverFixture(destination = "https://youtube.com/watch?v=abcdefghijk") {
  return { name: "Test resolver", kind: "resolver", providers: [{ name: "mock", scrape: async () => ({
    status: true, result: { destinationUrl: destination, downloads: [{ type: "link", url: destination }] },
  }) }] };
}

test("tautan resolver otomatis dilanjutkan ke provider media", async () => {
  let usedFormat;
  const target = { name: "YouTube", providers: [{ name: "media", scrape: async (_, format) => {
    usedFormat = format;
    return { status: true, result: { title: "Lagu", downloads: [{ type: "audio", url: "https://cdn.test/song" }] } };
  } }] };
  const result = await resolveDownload("https://short.test/abc", "mp3", { platform: resolverFixture(), detect: () => target });
  assert.equal(result.platform, "YouTube");
  assert.equal(result.resolver, "Test resolver");
  assert.equal(usedFormat, "mp3");
});

test("resolve-only tidak mengunduh media dan kegagalan lanjutan tetap mengembalikan link", async () => {
  const result = await resolveLink("https://short.test/abc", { platform: resolverFixture(), detect: () => assert.fail("must not download") });
  assert.equal(result.downloads[0].type, "link");
  const fallback = await resolveDownload("https://short.test/abc", "mp4", {
    platform: resolverFixture(), detect: () => ({ name: "YouTube", providers: [{ name: "failed", scrape: async () => { throw new Error("offline"); } }] }),
  });
  assert.equal(fallback.downloads[0].type, "link");
});

test("rantai resolver melindungi loop tanpa kehilangan tautan tujuan", async () => {
  const firstUrl = "https://short.test/first";
  const nextUrl = "https://short.test/next";
  const first = resolverFixture(nextUrl);
  const next = resolverFixture(firstUrl);
  const result = await resolveDownload(firstUrl, "mp4", { platform: first, detect: () => next });
  assert.equal(result.downloads[0].url, firstUrl);
});

test("menu awal punya tombol dan nama pengguna di-escape untuk HTML", async () => {
  const mock = telegramMock();
  await handleUpdate({ message: { text: "/start", from: { first_name: "<b>A&B</b>" }, chat: { id: 7 } } }, mock);
  const payload = mock.calls[0].payload;
  assert.equal(payload.parse_mode, "HTML");
  assert.match(payload.text, /&lt;b&gt;A&amp;B&lt;\/b&gt;/);
  assert.equal(payload.reply_markup.inline_keyboard.flat().length, 5);
  assert.ok(menuPage("platforms").text.includes("Safelinku"));
});

test("callback menu diakui lalu pesan menu diperbarui", async () => {
  const mock = telegramMock();
  await handleUpdate({ callback_query: { id: "callback-1", data: "menu:resolver", from: { first_name: "A" }, message: { message_id: 42, chat: { id: 7 } } } }, mock);
  assert.deepEqual(mock.calls.map((call) => call.method), ["answerCallbackQuery", "editMessageText"]);
  assert.match(mock.calls[1].payload.text, /LINK RESOLVER/);
  assert.equal(mock.calls[1].payload.reply_markup.inline_keyboard[0][0].callback_data, "menu:resolve_input");
});

test("tombol audio mengirim ForceReply dan balasannya menggunakan format MP3", async () => {
  const mock = telegramMock();
  await handleUpdate({ callback_query: { id: "callback-2", data: "menu:audio", message: { message_id: 42, chat: { id: 7 } } } }, mock);
  assert.equal(mock.calls[1].payload.reply_markup.force_reply, true);
  let format;
  await handleUpdate({ message: { text: "https://youtu.be/abcdefghijk", chat: { id: 7 }, reply_to_message: { text: prompts.audio, from: { is_bot: true } } } }, {
    telegram: mock.telegram, resolve: async (_, value) => {
      format = value;
      return { title: "Audio", platform: "YouTube", provider: "mock", downloads: [{ type: "audio", url: "https://cdn.test/song" }] };
    },
  });
  assert.equal(format, "mp3");
});

test("/resolve dan balasan prompt resolver memakai resolve-only", async () => {
  for (const isReply of [false, true]) {
    const mock = telegramMock();
    let calls = 0;
    await handleUpdate({ message: { text: `${isReply ? "" : "/resolve "}https://bit.ly/abc`, chat: { id: 7 }, ...(isReply ? { reply_to_message: { text: prompts.resolve_input, from: { is_bot: true } } } : {}) } }, {
      telegram: mock.telegram,
      resolve: () => assert.fail("must not download"),
      resolveOnly: async () => {
        calls++;
        return { title: "Destination", platform: "Unshorten", provider: "mock", destinationUrl: "https://example.com", downloads: [{ type: "link", url: "https://example.com" }] };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(mock.calls.map((call) => call.method), ["sendMessage", "editMessageText"]);
    assert.match(mock.calls[1].payload.text, /https:\/\/example.com/);
  }
});

test("resolver publik menolak localhost, alamat privat, dan DNS ke jaringan lokal", async () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("10.0.0.1"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(validatePublicUrl("https://127.0.0.1"));
  await assert.rejects(validatePublicUrl("https://example.com", async () => [{ address: "192.168.1.1" }]));
  await validatePublicUrl("https://example.com", async () => [{ address: "8.8.8.8" }]);
});

test("library Unshorten mengikuti redirect dan meta-refresh serta memvalidasi tiap hop", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/start") { res.writeHead(302, { Location: "/meta" }); res.end(); }
    else if (req.url === "/meta") res.end('<meta http-equiv="refresh" content="0;url=/final">');
    else res.end("Destination page");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const validated = [];
  const response = await unshorten(`${base}/start`, { autoResolve: false, proxy: false, validateUrl: async (url) => { validated.push(url); } });
  assert.equal(response.status, true);
  assert.equal(response.result.destinationUrl, `${base}/final`);
  assert.deepEqual(validated, [`${base}/start`, `${base}/meta`, `${base}/final`]);
  const blocked = await unshorten(`${base}/start`, { autoResolve: false, validateUrl: validatePublicUrl });
  assert.equal(blocked.status, false);
  assert.match(blocked.message, /publik/);
});
