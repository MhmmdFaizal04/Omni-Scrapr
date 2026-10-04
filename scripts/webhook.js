const { createTelegram } = require("../src/telegram");

async function main() {
  const telegram = createTelegram(process.env.TELEGRAM_BOT_TOKEN);
  const action = process.argv[2];
  if (action === "info") {
    console.log(JSON.stringify(await telegram("getWebhookInfo"), null, 2));
    return;
  }
  if (action === "delete") {
    console.log(await telegram("deleteWebhook", { drop_pending_updates: false }));
    return;
  }
  if (action !== "set") throw new Error("Gunakan set, info, atau delete.");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error("TELEGRAM_WEBHOOK_SECRET harus 32–256 karakter: huruf, angka, _ atau -.");
  const base = new URL(process.env.BOT_BASE_URL);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("BOT_BASE_URL harus URL HTTPS publik.");
  const result = await telegram("setWebhook", {
    url: new URL("/api/webhook", base).href,
    secret_token: secret,
    allowed_updates: ["message"],
    max_connections: 10,
    drop_pending_updates: false,
  });
  await telegram("setMyCommands", { commands: [
    { command: "start", description: "Mulai menggunakan bot" },
    { command: "help", description: "Panduan penggunaan" },
    { command: "download", description: "Unduh dari tautan" },
    { command: "mp3", description: "Audio dari YouTube" },
    { command: "mp4", description: "Video dari YouTube" },
    { command: "platforms", description: "Daftar platform" },
  ] });
  console.log("Webhook terpasang:", result);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
