const test = require("node:test");
const assert = require("node:assert/strict");
const { scrape: youtube, extractVideoId } = require("../lib/youtube/ytmp3");
const { scrape: safelinku, SimpleCookieJar } = require("../lib/resolver/safelinku");
const { detectPlatform, resolveDownload } = require("../src/platforms");

test("YouTube menormalkan watch, Shorts, live, dan youtu.be tanpa parameter tracking", () => {
  for (const url of ["https://youtu.be/xVCErUW1eb8?si=tracking", "https://m.youtube.com/watch?v=xVCErUW1eb8&list=123", "https://youtube.com/shorts/xVCErUW1eb8", "https://youtube.com/live/xVCErUW1eb8"]) assert.equal(extractVideoId(url), "xVCErUW1eb8");
  assert.equal(extractVideoId("https://evil.test/?v=xVCErUW1eb8"), null);
  assert.equal(extractVideoId("https://youtu.be/xVCErUW1eb8extra"), null);
});

test("convert1s memakai URL canonical dan polling status dengan URL relatif", async () => {
  let polls = 0;
  const result = await youtube("https://youtu.be/xVCErUW1eb8?si=tracking", "mp4", {
    metadata: false, provider: "convert1s", sleep: async () => {},
    client: {
      post: async (_, body) => {
        assert.equal(body.url, "https://www.youtube.com/watch?v=xVCErUW1eb8");
        assert.equal(body.output.type, "video");
        return { data: { statusUrl: "/api/status/123", selectedQuality: "360p" } };
      },
      get: async (url) => {
        assert.equal(url, "https://hub.convert1s.com/api/status/123");
        return { data: ++polls === 1 ? { status: "processing" } : { status: "completed", downloadUrl: "https://cdn.test/file.mp4" } };
      },
    },
  });
  assert.equal(result.status, true);
  assert.equal(result.result.downloads[0].quality, "360p");
  assert.equal(polls, 2);
});

test("legacy merupakan provider terpisah dan menerima unduhan yang sudah selesai", async () => {
  const calls = [];
  const result = await youtube("https://youtu.be/xVCErUW1eb8", "mp3", {
    metadata: false, provider: "ymcdn", sleep: async () => {},
    client: { get: async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Origin, "https://ytmp3.mobi");
      if (url.endsWith("/init")) return { data: { convertURL: "/api/v1/convert?sig=test", error: 0 } };
      assert.equal(options.params.f, "mp3");
      return { data: { error: 0, downloadURL: "//cdn.test/file.mp3" } };
    } },
  });
  assert.equal(result.status, true);
  assert.equal(result.result.downloads[0].url, "https://cdn.test/file.mp3");
  assert.equal(calls.length, 2);
});

test("legacy tidak menganggap progress 4 sebagai unduhan berhasil", async () => {
  const result = await youtube("https://youtu.be/xVCErUW1eb8", "mp4", {
    metadata: false, provider: "ymcdn", sleep: async () => {},
    client: { get: async (url) => ({ data: url.endsWith("/init") ? { convertURL: "https://api.test/convert" } : url.endsWith("/convert") ? { progressURL: "https://api.test/progress", downloadURL: "https://cdn.test/broken" } : { progress: 4 } }) },
  });
  assert.equal(result.status, false);
  assert.equal(result.errors[0].code, "CONVERSION_FAILED");
});

test("API legacy menolak akses dengan kode yang tetap terlihat", async () => {
  const result = await youtube("https://youtu.be/xVCErUW1eb8", "mp4", {
    metadata: false, provider: "ymcdn",
    client: { get: async () => ({ data: { status: false, error: { code: "ERR_DIRECT_ACCESS_DENIED", message: "Use the web interface" } } }) },
  });
  assert.equal(result.status, false);
  assert.equal(result.errors[0].code, "ERR_DIRECT_ACCESS_DENIED");
});

test("redirect legacy berulang berhenti tanpa loop tak terbatas", async () => {
  const result = await youtube("https://youtu.be/xVCErUW1eb8", "mp4", {
    metadata: false, provider: "ymcdn",
    client: { get: async (url) => ({ data: url.endsWith("/init") ? { convertURL: "https://api.test/convert" } : { redirect: 1, redirectURL: "https://api.test/convert" } }) },
  });
  assert.equal(result.errors[0].code, "REDIRECT_LOOP");
});

test("cookie gabungan mempertahankan SESSION dan tidak bocor ke domain lain", () => {
  const jar = new SimpleCookieJar();
  jar.setFromHeaders({ "set-cookie": "XSRF-TOKEN=abc; expires=Mon, 05 Oct 2026 12:00:00 GMT; path=/, SESSION=def; path=/; HttpOnly" }, "https://app.khaddavi.net/step1");
  assert.equal(jar.get("XSRF-TOKEN", "https://app.khaddavi.net/step2"), "abc");
  assert.equal(jar.getCookieHeader("https://app.khaddavi.net/api/session"), "XSRF-TOKEN=abc; SESSION=def");
  assert.equal(jar.getCookieHeader("https://sfl.gl/ready/go"), "");
});

test("Safelinku sfl.gl melewati gateway, membawa cookie, dan membaca tujuan Sfile", async () => {
  assert.equal(detectPlatform("https://sfl.gl/emLL5").name, "Safelinku");
  let sessions = 0;
  const client = async ({ url, method, headers }) => {
    const parsed = new URL(url);
    if (parsed.hostname === "sfl.gl" && parsed.pathname === "/emLL5") return { status: 200, headers: {}, data: '<form id="form" action="https://app.khaddavi.net/redirect.php"><input value="ray" type="hidden" name="ray_id"><input value="emLL5" name="alias"></form>' };
    if (parsed.pathname === "/redirect.php") return { status: 302, headers: { location: "/step1" }, data: "" };
    if (parsed.pathname === "/step1") return { status: 200, headers: { "set-cookie": "XSRF-TOKEN=abc; path=/, SESSION=def; path=/" }, data: "article" };
    assert.equal(headers.Cookie, parsed.hostname === "app.khaddavi.net" ? "XSRF-TOKEN=abc; SESSION=def" : undefined);
    if (parsed.pathname === "/api/session") { assert.equal(method, "POST"); return { status: 200, headers: {}, data: { step: ++sessions === 1 ? 1 : 2 } }; }
    if (parsed.pathname === "/api/verify") return { status: 200, headers: {}, data: { target: "/redirect.php" } };
    if (parsed.pathname === "/api/go") return { status: 200, headers: {}, data: { url: "https://sfl.gl/ready/go" } };
    if (parsed.pathname === "/ready/go") return { status: 200, headers: {}, data: '<script>window.location.href="https://sfile.co/Wc3m1mgcLWS";</script>' };
    assert.fail(`Unexpected request ${parsed.pathname}`);
  };
  const result = await safelinku("https://sfl.gl/emLL5", { autoResolve: false, client, sleep: async () => {} });
  assert.equal(result.status, true, result.message);
  assert.equal(result.result.destinationUrl, "https://sfile.co/Wc3m1mgcLWS");
});

test("kegagalan provider tercatat dengan kode tanpa membocorkan URL atau token", async () => {
  const failures = [];
  const platform = { name: "YouTube", providers: [{ name: "ymcdn", scrape: async () => ({ status: false, errors: [{ code: "ERR_DIRECT_ACCESS_DENIED", message: "secret-url" }] }) }] };
  await assert.rejects(resolveDownload("https://youtu.be/xVCErUW1eb8", "mp4", { platform, onFailure: (details) => failures.push(details) }), /ERR_DIRECT_ACCESS_DENIED/);
  assert.deepEqual(failures, [{ platform: "YouTube", provider: "ymcdn", code: "ERR_DIRECT_ACCESS_DENIED" }]);
});
