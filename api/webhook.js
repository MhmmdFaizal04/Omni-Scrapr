const { waitUntil } = require("@vercel/functions");
const { createWebhook } = require("../src/webhook");
const { handleUpdate } = require("../src/bot");
const { createTelegram } = require("../src/telegram");

module.exports = createWebhook({
  waitUntil,
  processUpdate: (update) => handleUpdate(update, { telegram: createTelegram(process.env.TELEGRAM_BOT_TOKEN) }),
});
