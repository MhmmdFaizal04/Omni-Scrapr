const { timingSafeEqual } = require("node:crypto");

function validSecret(received, expected) {
  if (typeof received !== "string" || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createWebhook({ waitUntil, processUpdate, env = process.env }) {
  // Best-effort dedup untuk retry pada instance yang sama; bukan penyimpanan persisten.
  const seen = new Map();
  return function webhook(req, res) {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error: "Bot is not configured" });
    if (!validSecret(req.headers["x-telegram-bot-api-secret-token"], env.TELEGRAM_WEBHOOK_SECRET)) return res.status(401).json({ error: "Unauthorized" });
    let update = req.body;
    if (typeof update === "string") {
      try { update = JSON.parse(update); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
    }
    if (!update || !Number.isSafeInteger(update.update_id)) return res.status(400).json({ error: "Invalid update" });
    const now = Date.now();
    for (const [id, expires] of seen) if (expires <= now) seen.delete(id);
    if (!seen.has(update.update_id)) {
      if (seen.size >= 1000) seen.delete(seen.keys().next().value);
      seen.set(update.update_id, now + 300000);
      // Vercel menjaga promise tetap berjalan setelah webhook diakui.
      waitUntil(Promise.resolve().then(() => processUpdate(update)).catch(() => {
        console.error("Pemrosesan update Telegram gagal", { update_id: update.update_id });
      }));
    }
    return res.status(200).json({ ok: true });
  };
}

module.exports = { createWebhook, validSecret };
