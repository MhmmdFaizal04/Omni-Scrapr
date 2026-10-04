// Import provider secara eksplisit supaya Vercel dapat melacak dependensinya.
// Provider yang membutuhkan Chrome atau executable lokal tidak dipakai.
const provider = (name, scrape) => ({ name, scrape });
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
    provider("ytmp3", (url, format) => require("../lib/youtube/ytmp3").scrape(url, format)),
    provider("ytmp3gg", (url, format) => require("../lib/youtube/ytmp3gg").scrape(url, { format })),
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
  { name: "MediaFire", hosts: ["mediafire.com"], providers: [
    provider("mediafire", require("../lib/resolver/mediafire").scrape),
  ] },
  { name: "Sfile", hosts: ["sfile.mobi"], providers: [
    provider("sfile", require("../lib/resolver/sfile").scrape),
  ] },
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
    if (/audio|mp3|m4a|wav/.test(rawType)) type = "audio";
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
  const platform = options.platform || detectPlatform(url);
  if (!platform) throw new Error("Platform tautan ini belum didukung. Ketik /platforms untuk melihat daftar.");
  if (format === "mp3" && platform.name !== "YouTube") {
    throw new Error("Perintah /mp3 hanya untuk YouTube. Untuk platform lain, kirim tautannya langsung.");
  }
  const deadline = Date.now() + (options.totalTimeout || 170000);
  for (const entry of platform.providers) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await withTimeout(Promise.resolve().then(() => entry.scrape(url, format)), Math.min(options.providerTimeout || 60000, remaining));
      const downloads = normalizeDownloads(response?.result);
      if (response?.status === true && downloads.length) {
        return { ...response.result, downloads, platform: platform.name, provider: entry.name };
      }
    } catch {
      // Lanjut ke provider berikutnya jika jaringan/provider gagal.
    }
  }
  throw new Error("Media belum berhasil diambil. Pastikan tautan publik dan valid, lalu coba lagi nanti.");
}

module.exports = { platforms, safeUrl, detectPlatform, normalizeDownloads, resolveDownload };
