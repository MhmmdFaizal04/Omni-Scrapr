function createTelegram(token, fetchImpl = fetch) {
  return async function telegram(method, payload = {}) {
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diatur.");
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      // Jangan bocorkan URL request yang mengandung token bot ke log.
      throw new Error(`Telegram ${method}: koneksi gagal atau timeout`);
    }
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram ${method}: ${data.description || response.status}`);
    }
    return data.result;
  };
}

module.exports = { createTelegram };
