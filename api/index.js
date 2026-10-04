module.exports = function health(req, res) {
  res.status(200).json({ service: "BotDown Telegram", status: "ok", webhook: "/api/webhook" });
};
