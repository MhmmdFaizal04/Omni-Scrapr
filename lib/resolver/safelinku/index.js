const axios = require("axios");
const crypto = require("crypto");
const cheerio = require("cheerio");

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function extractCleanUrl(text) {
  if (!text || typeof text !== "string") return "";
  const match = text.match(/https?:\/\/[^\s]+/i);
  let clean = match ? match[0] : text.trim();
  if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
    clean = "https://" + clean;
  }
  return clean;
}

class SimpleCookieJar {
  constructor(options = {}) {
    this.cookies = new Map();
    this.client = options.client || axios;
    this.onRequest = options.onRequest;
    this.timeout = options.timeout || 15000;
    this.sleep = options.sleep || sleep;
  }

  setFromHeaders(headers, url) {
    if (!headers) return;
    const raw = headers["set-cookie"];
    if (!raw) return;
    const list = (Array.isArray(raw) ? raw : [raw]).flatMap((item) => item.split(/,(?=\s*[^;,=\s]+=)/));
    for (const item of list) {
      if (!item) continue;
      const part = item.split(";")[0].trim();
      const eqIdx = part.indexOf("=");
      if (eqIdx !== -1) {
        const name = part.slice(0, eqIdx).trim();
        const value = part.slice(eqIdx + 1).trim();
        const originHost = new URL(url).hostname;
        const declared = item.match(/;\s*domain=([^;]+)/i)?.[1]?.trim().replace(/^\./, "");
        const domain = declared || originHost;
        if (originHost !== domain && !originHost.endsWith(`.${domain}`)) continue;
        if (name) this.cookies.set(`${domain}:${name}`, { name, value, domain, hostOnly: !declared });
      }
    }
  }

  getCookieHeader(url) {
    const host = new URL(url).hostname;
    return [...this.cookies.values()].filter((cookie) => cookie.domain === host || (!cookie.hostOnly && host.endsWith(`.${cookie.domain}`))).map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  get(name, url) {
    const host = new URL(url).hostname;
    return [...this.cookies.values()].find((cookie) => cookie.name === name && (cookie.domain === host || (!cookie.hostOnly && host.endsWith(`.${cookie.domain}`))))?.value;
  }
}

function generateSessionToken(rawXsrfCookie) {
  const unquotedXsrf = decodeURIComponent(rawXsrfCookie);
  const dummyFp = crypto
    .createHash("sha256")
    .update(
      "webgl:ANGLE (Intel, Intel(R) UHD Graphics Direct3D11)||canvas:abc12345||env:Asia/Jakarta,1920,1080",
    )
    .digest("hex");

  const hashPart = "#" + Buffer.from(dummyFp).toString("base64");
  return unquotedXsrf.slice(0, 128 - hashPart.length) + hashPart;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchHttp(url, options = {}, jar) {
  let currentUrl = url;
  let method = options.method || "GET";
  let data = options.data;
  let headers = {
    "User-Agent": DEFAULT_UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...(options.headers || {}),
  };

  const maxHops = 10;
  for (let hop = 0; hop < maxHops; hop++) {
    const cookieHeader = jar ? jar.getCookieHeader(currentUrl) : "";
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    else delete headers["Cookie"];

    let res;
    try {
      res = await jar.client({
        url: currentUrl,
        method,
        data,
        headers,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        timeout: jar.timeout,
      });
    } catch (error) {
      error.providerHost = new URL(currentUrl).hostname;
      throw error;
    }

    if (jar) jar.setFromHeaders(res.headers, currentUrl);
    jar.onRequest?.({ method, host: new URL(currentUrl).hostname, path: new URL(currentUrl).pathname, status: res.status });

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      headers["Referer"] = currentUrl;
      currentUrl = new URL(res.headers.location, currentUrl).href;
      method = "GET";
      data = undefined;
      continue;
    }

    return { url: currentUrl, status: res.status, headers: res.headers, data: res.data };
  }

  throw new Error("Too many redirects");
}

function checkBase64Params(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const keys = ["url", "link", "target", "go", "u", "dest"];
    for (const key of keys) {
      const val = parsed.searchParams.get(key);
      if (!val) continue;
      try {
        const decoded = Buffer.from(val, "base64").toString("utf-8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      } catch {}
      if (/^https?:\/\//i.test(val)) return val;
    }
  } catch {}
  return null;
}

async function resolveGateway(html, currentUrl, jar) {
  const $ = cheerio.load(html);
  const form = $("form").filter((_, element) => $(element).find('input[name="ray_id"]').length > 0).first();
  const actionUrl = form.attr("action");
  const rayId = form.find('input[name="ray_id"]').attr("value");
  const alias = form.find('input[name="alias"]').attr("value");
  if (!actionUrl || !rayId || !alias) return null;

  const parsedAction = new URL(actionUrl, currentUrl);
  const blogOrigin = `${parsedAction.protocol}//${parsedAction.host}`;
  const redirectUrl = `${blogOrigin}/redirect.php?ray_id=${encodeURIComponent(
    rayId,
  )}&alias=${encodeURIComponent(alias)}`;

  const r2 = await fetchHttp(
    redirectUrl,
    { headers: { Referer: currentUrl } },
    jar,
  );
  const step1PageUrl = r2.url;

  const xsrf1 = jar.get("XSRF-TOKEN", step1PageUrl);
  if (!xsrf1) return null;

  const tokenPayload1 = generateSessionToken(xsrf1);
  const sessionHeaders = {
    Origin: blogOrigin,
    Referer: step1PageUrl,
    "Content-Type": "application/json",
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
  };

  const sessionRes1 = await fetchHttp(
    `${blogOrigin}/api/session`,
    {
      method: "POST",
      headers: sessionHeaders,
      data: JSON.stringify({ _token: tokenPayload1 }),
    },
    jar,
  );

  let sessionData1 = {};
  try {
    sessionData1 =
      typeof sessionRes1.data === "object"
        ? sessionRes1.data
        : JSON.parse(sessionRes1.data);
  } catch {}

  let step = sessionData1.step || 1;
  let step2PageUrl = step1PageUrl;

  if (step === 1) {
    await jar.sleep(800);
    const verifyRes = await fetchHttp(
      `${blogOrigin}/api/verify`,
      {
        method: "POST",
        headers: sessionHeaders,
        data: JSON.stringify({ _a: 0, captcha: null, passcode: null }),
      },
      jar,
    );

    let verifyData = {};
    try {
      verifyData =
        typeof verifyRes.data === "object"
          ? verifyRes.data
          : JSON.parse(verifyRes.data);
    } catch {}

    let target = verifyData.target || "/redirect.php";
    if (target.startsWith("/")) target = `${blogOrigin}${target}`;

    const r3 = await fetchHttp(
      target,
      { headers: { Referer: step1PageUrl } },
      jar,
    );
    step2PageUrl = r3.url;

    const xsrf2 = jar.get("XSRF-TOKEN", step2PageUrl) || xsrf1;
    sessionHeaders["Referer"] = step2PageUrl;
    await fetchHttp(
      `${blogOrigin}/api/session`,
      {
        method: "POST",
        headers: sessionHeaders,
        data: JSON.stringify({ _token: generateSessionToken(xsrf2) }),
      },
      jar,
    );
  }

  await jar.sleep(1500);
  const key = 500;
  const size = `${(1920 + key) * 2}.${(1080 + key) * 2}`;

  sessionHeaders["Referer"] = step2PageUrl;
  const goRes = await fetchHttp(
    `${blogOrigin}/api/go`,
    {
      method: "POST",
      headers: sessionHeaders,
      data: JSON.stringify({ key, size }),
    },
    jar,
  );

  let goData = {};
  try {
    goData =
      typeof goRes.data === "object" ? goRes.data : JSON.parse(goRes.data);
  } catch {
    return null;
  }

  let readyUrl = goData.url;
  if (!readyUrl) return null;
  if (!/^https?:\/\//i.test(readyUrl)) {
    readyUrl = new URL(readyUrl, blogOrigin).href;
  }

  const rReady = await fetchHttp(
    readyUrl,
    { headers: { Referer: step2PageUrl } },
    jar,
  );
  const htmlReady =
    typeof rReady.data === "string" ? rReady.data : JSON.stringify(rReady.data);

  const destMatch = htmlReady.match(
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
  );
  if (destMatch) {
    return destMatch[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
  }

  return readyUrl;
}

async function scrape(url, options = {}) {
  try {
    if (!url || typeof url !== "string") throw new Error("Invalid URL.");
    const initialUrl = extractCleanUrl(url);
    const autoResolve = options.autoResolve !== false;

    const b64Check = checkBase64Params(initialUrl);
    if (b64Check) {
      let finalUrl = b64Check;
      if (autoResolve) {
        if (/https?:\/\/(?:www\.)?mediafire\.com\//i.test(finalUrl)) {
          const mediafire = require("../mediafire");
          const mfRes = await mediafire.scrape(finalUrl);
          if (mfRes.status && mfRes.result) {
            return {
              status: true,
              result: {
                ...mfRes.result,
                originalUrl: initialUrl,
                destinationUrl: finalUrl,
              },
            };
          }
        }

        if (/https?:\/\/(?:www\.)?sfile\.(?:co|mobi)\//i.test(finalUrl)) {
          const sfile = require("../sfile");
          const sfileRes = await sfile.scrape(finalUrl);
          if (sfileRes.status && sfileRes.result) {
            return {
              status: true,
              result: {
                ...sfileRes.result,
                originalUrl: initialUrl,
                destinationUrl: finalUrl,
              },
            };
          }
        }
      }

      return {
        status: true,
        result: {
          title: "Safelinku Destination Link",
          originalUrl: initialUrl,
          destinationUrl: finalUrl,
          url: finalUrl,
          downloads: [{ type: "link", quality: "Direct Link", url: finalUrl }],
        },
      };
    }

    const jar = new SimpleCookieJar(options);
    const visited = new Set();
    let currentUrl = initialUrl;
    const maxChain = 8;

    for (let hop = 0; hop < maxChain; hop++) {
      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);

      const res = await fetchHttp(currentUrl, {}, jar);
      currentUrl = res.url;
      const html = typeof res.data === "string" ? res.data : "";

      // Endpoint shortlink juga dapat mengembalikan gateway sebagai JSON.
      if (res.data?.url && res.data?.ray_id) {
        const action = String(res.data.url).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const ray = String(res.data.ray_id).replace(/"/g, "&quot;");
        const alias = new URL(initialUrl).pathname.split("/").filter(Boolean).at(-1);
        const resolved = await resolveGateway(`<form action="${action}"><input name="ray_id" value="${ray}"><input name="alias" value="${alias}"></form>`, currentUrl, jar);
        if (!resolved) throw Object.assign(new Error("Safelinku gateway tidak mengembalikan tujuan"), { code: "GATEWAY_FAILED" });
        currentUrl = resolved;
        break;
      }

      if (
        html.includes('name="ray_id"') ||
        html.includes("name='ray_id'") ||
        html.includes("redirect.php")
      ) {
        const resolved = await resolveGateway(html, currentUrl, jar);
        if (resolved && resolved !== currentUrl) {
          currentUrl = resolved;
          break;
        }
      }

      const metaRefresh = html.match(
        /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i,
      );
      if (metaRefresh && metaRefresh[1]) {
        currentUrl = new URL(metaRefresh[1].trim(), currentUrl).href;
        continue;
      }

      const scriptRedirect = html.match(
        /window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i,
      );
      if (scriptRedirect && scriptRedirect[1] && scriptRedirect[1] !== currentUrl) {
        currentUrl = scriptRedirect[1].replace(/\\\//g, "/");
        continue;
      }

      break;
    }

    if (currentUrl === initialUrl) {
      throw new Error("Could not resolve Safelinku destination URL.");
    }

    if (autoResolve) {
      if (/https?:\/\/(?:www\.)?mediafire\.com\//i.test(currentUrl)) {
        const mediafire = require("../mediafire");
        const mfRes = await mediafire.scrape(currentUrl);
        if (mfRes.status && mfRes.result) {
          return {
            status: true,
            result: {
              ...mfRes.result,
              originalUrl: initialUrl,
              destinationUrl: currentUrl,
            },
          };
        }
      }

      if (/https?:\/\/(?:www\.)?sfile\.(?:co|mobi)\//i.test(currentUrl)) {
        const sfile = require("../sfile");
        const sfileRes = await sfile.scrape(currentUrl);
        if (sfileRes.status && sfileRes.result) {
          return {
            status: true,
            result: {
              ...sfileRes.result,
              originalUrl: initialUrl,
              destinationUrl: currentUrl,
            },
          };
        }
      }
    }

    return {
      status: true,
      result: {
        title: "Safelinku Destination Link",
        originalUrl: initialUrl,
        destinationUrl: currentUrl,
        url: currentUrl,
        downloads: [{ type: "link", quality: "Direct Link", url: currentUrl }],
      },
    };
  } catch (error) {
    return {
      status: false,
      message: error.message,
      code: error.response?.status ? `HTTP_${error.response.status}` : error.code || "RESOLVE_FAILED",
      ...(error.providerHost ? { host: error.providerHost } : {}),
    };
  }
}

module.exports = { scrape, SimpleCookieJar };
