const axios = require("axios");

function extractVideoId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let id;
    if (host === "youtu.be") id = url.pathname.split("/")[1];
    else if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      id = url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/]+)/)?.[1];
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}

function providerError(message, code = "PROVIDER_ERROR") {
  return Object.assign(new Error(message), { code });
}

function checkResponse(data, stage) {
  if (!data || typeof data !== "object") throw providerError(`${stage}: respons provider bukan JSON`, "INVALID_RESPONSE");
  if (data.status === false || (data.error && data.error !== 0)) {
    const code = typeof data.error === "object" ? data.error.code || String(data.error.id || "PROVIDER_ERROR") : String(data.error);
    const message = typeof data.error === "object" ? data.error.message : "Provider menolak konversi";
    throw Object.assign(providerError(`${stage}: ${message || "Provider menolak konversi"}`, code), { stage });
  }
  return data;
}

function errorInfo(error) {
  const context = error.stage ? { stage: error.stage } : {};
  try { context.host = new URL(error.config.url).hostname; } catch { /* Error internal tidak memiliki URL. */ }
  if (error.response?.status) return { ...context, code: `HTTP_${error.response.status}`, message: `Provider mengembalikan HTTP ${error.response.status}` };
  if (["ECONNABORTED", "ETIMEDOUT", "TIMEOUT"].includes(error.code)) return { ...context, code: "TIMEOUT", message: "Provider melewati batas waktu" };
  if (["ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "ECONNREFUSED"].includes(error.code)) return { ...context, code: error.code, message: "Koneksi ke provider gagal" };
  return { ...context, code: error.code || "PROVIDER_ERROR", message: error.message };
}

async function scrape(url, format = "mp4", options = {}) {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) throw providerError("Tautan video YouTube tidak valid", "INVALID_URL");
    if (!["mp3", "mp4"].includes(format)) throw providerError("Format harus mp3 atau mp4", "INVALID_FORMAT");
    // Buang parameter tracking dan samakan watch/shorts/live/youtu.be.
    const canonical = `https://www.youtube.com/watch?v=${videoId}`;
    const client = options.client || axios;
    const pause = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + (options.timeout || 50000);
    const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" };
    const requestOptions = (extra = {}) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw providerError("Provider melewati batas waktu", "TIMEOUT");
      return { ...extra, timeout: Math.min(10000, remaining), maxContentLength: 2 * 1024 * 1024 };
    };
    let meta = { title: "YouTube Video", thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    if (options.metadata !== false) {
      try {
        const { data } = await client.get("https://www.youtube.com/oembed", requestOptions({ params: { url: canonical, format: "json" } }));
        meta = { title: data.title || meta.title, thumbnail: data.thumbnail_url || meta.thumbnail };
      } catch { /* Metadata tidak boleh menggagalkan konversi. */ }
    }
    const makeDownload = (value, quality, base) => {
      const parsed = new URL(value, base);
      if (!["http:", "https:"].includes(parsed.protocol)) throw providerError("URL unduhan provider tidak valid", "INVALID_RESPONSE");
      return { type: format === "mp3" ? "audio" : "video", quality: quality || (format === "mp3" ? "128kbps" : "720p"), url: parsed.href };
    };

    async function convert1s() {
      const convertHeaders = { ...headers, Origin: "https://media.ytmp3.gg", Referer: "https://media.ytmp3.gg/", "Content-Type": "application/json" };
      const endpoint = "https://hub.convert1s.com/api/download";
      const { data } = await client.post(endpoint, {
        url: canonical, os: "macos",
        output: { type: format === "mp4" ? "video" : "audio", format, quality: format === "mp4" ? "720p" : "" },
        audio: { bitrate: "128k" },
      }, requestOptions({ headers: convertHeaders }));
      const conversion = checkResponse(data, "convert1s");
      if (conversion.downloadUrl) return makeDownload(conversion.downloadUrl, conversion.selectedQuality, endpoint);
      if (!conversion.statusUrl) throw providerError("convert1s: URL status tidak tersedia", "INVALID_RESPONSE");
      const statusUrl = new URL(conversion.statusUrl, endpoint).href;
      for (let attempt = 0; attempt < 25 && Date.now() < deadline; attempt++) {
        await pause(Math.min(1200, Math.max(0, deadline - Date.now())));
        const { data: poll } = await client.get(statusUrl, requestOptions({ headers: convertHeaders }));
        checkResponse(poll, "convert1s");
        if (poll.downloadUrl && ["completed", "done", "success"].includes(poll.status)) return makeDownload(poll.downloadUrl, conversion.selectedQuality, endpoint);
        if (["failed", "error"].includes(poll.status)) throw providerError("convert1s gagal mengonversi video", "CONVERSION_FAILED");
      }
      throw providerError("convert1s: konversi belum selesai", "TIMEOUT");
    }

    async function ymcdn() {
      const legacyHeaders = { ...headers, Origin: "https://ytmp3.mobi", Referer: "https://ytmp3.mobi/en8/", Accept: "*/*" };
      const initUrl = "https://a.ymcdn.org/api/v1/init";
      const { data: init } = await client.get(initUrl, requestOptions({ headers: legacyHeaders, params: { p: "y", 23: "1llum1n471", _: Math.random() } }));
      checkResponse(init, "ymcdn init");
      if (!init.convertURL) throw providerError("ymcdn: URL konversi tidak tersedia", "INVALID_RESPONSE");
      let target = new URL(init.convertURL, initUrl).href;
      const visited = new Set();
      let conversion;
      for (let hop = 0; hop < 6; hop++) {
        if (visited.has(target)) throw providerError("ymcdn: redirect konversi berulang", "REDIRECT_LOOP");
        visited.add(target);
        const { data } = await client.get(target, requestOptions({ headers: legacyHeaders, params: { v: videoId, f: format, _: Math.random() } }));
        conversion = checkResponse(data, "ymcdn convert");
        if (!(conversion.redirect > 0)) break;
        if (!conversion.redirectURL) throw providerError("ymcdn: redirect tanpa URL", "INVALID_RESPONSE");
        target = new URL(conversion.redirectURL, target).href;
      }
      if (conversion.redirect > 0) throw providerError("ymcdn: terlalu banyak redirect", "REDIRECT_LIMIT");
      let finalUrl = conversion.downloadURL;
      if (!conversion.progressURL && finalUrl) return makeDownload(finalUrl, format === "mp3" ? "MP3" : "MP4", target);
      if (!conversion.progressURL) throw providerError("ymcdn: URL progres tidak tersedia", "INVALID_RESPONSE");
      const progressUrl = new URL(conversion.progressURL, target).href;
      for (let attempt = 0; attempt < 35 && Date.now() < deadline; attempt++) {
        const { data } = await client.get(progressUrl, requestOptions({ headers: legacyHeaders, params: { _: Math.random() } }));
        const progress = checkResponse(data, "ymcdn progress");
        if (progress.downloadURL) finalUrl = progress.downloadURL;
        if (progress.title) meta.title = progress.title;
        if (progress.progress === 4) throw providerError("ymcdn gagal mengonversi video", "CONVERSION_FAILED");
        if (progress.progress === 3 && finalUrl) return makeDownload(finalUrl, format === "mp3" ? "MP3" : "MP4", target);
        await pause(Math.min(1200, Math.max(0, deadline - Date.now())));
      }
      throw providerError("ymcdn: konversi belum selesai", "TIMEOUT");
    }

    const engines = options.provider === "ymcdn" ? [["ymcdn", ymcdn]] : options.provider === "convert1s" ? [["convert1s", convert1s]] : [["convert1s", convert1s], ["ymcdn", ymcdn]];
    const errors = [];
    for (const [provider, run] of engines) {
      try {
        const download = await run();
        return { status: true, result: { ...meta, type: download.type, downloads: [download] } };
      } catch (error) { errors.push({ provider, ...errorInfo(error) }); }
    }
    return { status: false, message: errors.map((error) => `${error.provider}: ${error.message}`).join("; "), errors };
  } catch (error) {
    return { status: false, message: error.message, code: error.code || "PROVIDER_ERROR" };
  }
}

module.exports = { scrape, extractVideoId };
