module.exports = function health(req, res) {
  res.status(200).json({ service: "BotDown Telegram", status: "ok", region: process.env.VERCEL_REGION || "local", webhook: "/api/webhook" });
};
