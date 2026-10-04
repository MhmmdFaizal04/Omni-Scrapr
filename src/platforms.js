// Import provider secara eksplisit supaya Vercel dapat melacak dependensinya.
// Provider yang membutuhkan Chrome atau executable lokal tidak dipakai.
const provider = (name, scrape) => ({ name, scrape });
const { validatePublicUrl, publicLookup } = require("./public-url");
const unshorten = provider("unshorten", (url) => require("../lib/resolver/unshorten").scrape(url, { autoResolve: false, validateUrl: validatePublicUrl, lookup: publicLookup, proxy: false }));
const genericResolver = { name: "Unshorten", kind: "resolver", hosts: ["bit.ly", "tinyurl.com", "t.co", "cutt.ly", "shorturl.at", "is.gd", "v.gd", "s.id", "rb.gy", "rebrand.ly", "shorturl.fm"], providers: [unshorten] };
const platforms = [
  { name: "TikTok", hosts: ["tiktok.com"], providers: [
    provider("snaptik", require("../lib/tiktok/snaptik").scrape),
    provider("tiktokio", require("../lib/tiktok/tiktokio").scrape),
    provider("ssstik", require("../lib/tiktok/ssstik").scrape),
  ] },
  { name: "Instagram", hosts: ["instagram.com"], providers: [
    provider("indown", require("../lib/instagram/indown").scrape),
    provider("snapsave", require("../lib/instagram/snapsave").scrape),
    provider("direct", require("../lib/instagram/direct").scrape),
  ] },
  { name: "YouTube", hosts: ["youtube.com", "youtu.be"], providers: [
    provider("ytmp3", (url, format) => require("../lib/youtube/ytmp3").scrape(url, format, { provider: "convert1s" })),
    provider("ymcdn", (url, format) => require("../lib/youtube/ytmp3").scrape(url, format, { provider: "ymcdn" })),
  ] },
  { name: "Facebook", hosts: ["facebook.com", "fb.watch", "fb.com"], providers: [
    provider("snapsave", require("../lib/facebook/snapsave").scrape),
  ] },
  { name: "Twitter / X", hosts: ["twitter.com", "x.com"], providers: [
    provider("direct", require("../lib/twitter/direct").scrape),
    provider("tweeload", require("../lib/twitter/tweeload").scrape),
  ] },
  { name: "Spotify", hosts: ["spotify.com", "spotify.link"], providers: [
    provider("spotidown", require("../lib/spotify/spotidown").scrape),
    provider("spotmate", require("../lib/spotify/spotmate").scrape),
  ] },
  { name: "SoundCloud", hosts: ["soundcloud.com", "snd.sc"], providers: [
    provider("klickaud", require("../lib/soundcloud/klickaud").scrape),
  ] },
  { name: "Apple Music", hosts: ["music.apple.com"], providers: [
    provider("aplmate", require("../lib/applemusic/aplmate").scrape),
  ] },
  { name: "Bandcamp", hosts: ["bandcamp.com"], providers: [
    provider("bandcampdownloader", require("../lib/bandcamp/bandcampdownloader").scrape),
  ] },
  { name: "Pinterest", hosts: ["pinterest.com", "pin.it"], providers: [
    provider("pindown", require("../lib/pinterest/pindown").scrape),
    provider("direct", require("../lib/pinterest/direct").scrape),
  ] },
  { name: "Reddit", hosts: ["reddit.com", "redd.it"], providers: [
    provider("rapidsave", require("../lib/reddit/rapidsave").scrape),
  ] },
  { name: "Threads", hosts: ["threads.net", "threads.com"], providers: [
    provider("threadster", require("../lib/threads/threadster").scrape),
  ] },
  { name: "Douyin", hosts: ["douyin.com", "iesdouyin.com"], providers: [
    provider("direct", require("../lib/douyin/direct").scrape),
  ] },
  { name: "Bilibili", hosts: ["bilibili.com", "b23.tv"], providers: [
    provider("direct", require("../lib/bilibili/direct").scrape),
  ] },
  { name: "Pixiv", hosts: ["pixiv.net"], providers: [
    provider("ajax", require("../lib/pixiv/ajax").scrape),
  ] },
  { name: "RedNote", hosts: ["xiaohongshu.com", "xhslink.com"], providers: [
    provider("direct", require("../lib/rednote/direct").scrape),
  ] },
  { name: "TeraBox", hosts: ["terabox.com", "teraboxapp.com", "1024terabox.com", "teraboxlink.com", "terasharelink.com"], providers: [
    provider("sechno", require("../lib/terabox/sechno").scrape),
  ] },
  { name: "MediaFire", kind: "resolver", hosts: ["mediafire.com"], providers: [
    provider("mediafire", require("../lib/resolver/mediafire").scrape),
  ] },
  { name: "Sfile", kind: "resolver", hosts: ["sfile.mobi", "sfile.co"], providers: [
    provider("sfile", require("../lib/resolver/sfile").scrape),
  ] },
  { name: "Safelinku", kind: "resolver", hosts: ["safelinku.com", "safelinku.net", "sfl.gl"], providers: [
    provider("safelinku", (url) => require("../lib/resolver/safelinku").scrape(url, { autoResolve: false })),
  ] },
  { name: "Sub2Unlock", kind: "resolver", hosts: ["sub2unlock.com", "sub2unlock.net", "sub2unlock.io", "sub2unlock.me"], providers: [
    provider("sub2unlock", (url) => require("../lib/resolver/sub2unlock").scrape(url, { autoResolve: false })),
  ] },
  { name: "Rekonise", kind: "resolver", hosts: ["rekonise.com"], providers: [
    provider("rekonise", (url) => require("../lib/resolver/rekonise").scrape(url, { autoResolve: false })),
  ] },
  genericResolver,
];

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function detectPlatform(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  return platforms.find((platform) => platform.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) || null;
}

function normalizeDownloads(result) {
  const seen = new Set();
  return (Array.isArray(result?.downloads) ? result.downloads : []).flatMap((item) => {
    const url = safeUrl(item?.url);
    if (!url || seen.has(url.href)) return [];
    seen.add(url.href);
    const rawType = String(item.type || result.type || "file").toLowerCase();
    let type = "file";
    if (rawType === "link") type = "link";
    else if (/audio|mp3|m4a|wav/.test(rawType)) type = "audio";
    else if (/image|photo|jpg|jpeg|png|webp/.test(rawType)) type = "image";
    else if (/video|mp4|mov|webm/.test(rawType)) type = "video";
    // HLS tidak dapat dikirim sebagai video langsung lewat Telegram.
    if (/m3u8/i.test(item.quality || "") || /\.m3u8(?:\?|$)/i.test(url.href)) type = "file";
    return [{ ...item, url: url.href, type }];
  });
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Provider timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function resolveDownload(url, format = "mp4", options = {}) {
  const detect = options.detect || detectPlatform;
  const platform = options.platform || detect(url);
  if (!platform) throw new Error("Platform tautan ini belum didukung. Ketik /platforms untuk melihat daftar.");
  if (format === "mp3" && platform.name !== "YouTube" && platform.kind !== "resolver") {
    throw new Error("Perintah /mp3 hanya untuk YouTube. Untuk platform lain, kirim tautannya langsung.");
  }
  const deadline = options.deadline || Date.now() + (options.totalTimeout || 170000);
  const failures = [];
  const recordFailure = (entry, code, status, context = {}) => {
    const failure = { platform: platform.name, provider: entry.name, code, ...(status ? { status } : {}), ...(context.host ? { host: context.host } : {}), ...(context.stage ? { stage: context.stage } : {}) };
    failures.push(failure);
    (options.onFailure || ((details) => console.warn("Downloader provider failed", details)))(failure);
  };
  for (const entry of platform.providers) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await withTimeout(Promise.resolve().then(() => entry.scrape(url, format)), Math.min(options.providerTimeout || 60000, remaining));
      const downloads = normalizeDownloads(response?.result);
      if (response?.status === true && downloads.length) {
        const result = { ...response.result, downloads, platform: platform.name, provider: entry.name, kind: platform.kind || "media" };
        const destination = safeUrl(result.destinationUrl || result.url || downloads[0].url)?.href;
        const target = !options.resolveOnly && destination && detect(destination);
        const visited = new Set(options.visited || [url]);
        if (platform.kind === "resolver" && !options.resolveOnly && target && !visited.has(destination) && visited.size < 4 && downloads.every((item) => item.type === "link") && deadline > Date.now()) {
          visited.add(destination);
          try {
            const next = await resolveDownload(destination, format, { ...options, platform: target, deadline, visited });
            return { ...next, originalUrl: url, destinationUrl: destination, resolver: [platform.name, next.resolver].filter(Boolean).join(" → ") };
          } catch {
            // Tetap berikan tautan tujuan jika unduhan lanjutan gagal.
          }
        }
        return result;
      }
      const detail = response?.errors?.at(-1);
      recordFailure(entry, detail?.code || response?.code || "NO_RESULT", undefined, detail || response || {});
    } catch (error) {
      recordFailure(entry, error.code || (error.message === "Provider timeout" ? "TIMEOUT" : "REQUEST_FAILED"), error.response?.status);
      // Lanjut ke provider berikutnya jika jaringan/provider gagal.
    }
  }
  const message = platform.kind === "resolver" ? "Tautan belum berhasil di-resolve." : "Media belum berhasil diambil.";
  const denied = failures.some(({ code }) => ["HTTP_403", "ERR_DIRECT_ACCESS_DENIED"].includes(code));
  const explanation = denied ? "Provider menolak akses dari server bot (403/access denied). Status publik tautan tidak menghapus pembatasan ini." : "Provider mungkin sedang bermasalah atau menolak koneksi server. Coba lagi nanti.";
  const details = failures.map(({ provider, code, host }) => `• ${provider}: ${code}${host ? ` (${host})` : ""}`).join("\n");
  throw new Error(`${message}\n${explanation}${details ? `\n\nDetail provider:\n${details}` : ""}`);
}

function resolveLink(url, options = {}) {
  const detected = detectPlatform(url);
  const platform = options.platform || (detected?.kind === "resolver" ? detected : genericResolver);
  return resolveDownload(url, "mp4", { ...options, platform, resolveOnly: true });
}

module.exports = { platforms, safeUrl, detectPlatform, normalizeDownloads, resolveDownload, resolveLink };
