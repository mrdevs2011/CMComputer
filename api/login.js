// Vercel serverless function — parolni tekshiradi, hech qachon o'zi saqlamaydi.
// Kerakli environment variable'lar (Vercel -> Settings -> Environment Variables):
//   PASSWORD_HASH  — parolning SHA-256 hex hashi (parolning o'zi emas!)
//   CMC_WS_HOST    — backend domeni, masalan satisfy-endurance-mooned.ngrok-free.dev
//   CMC_TOKEN      — brauzer terminali uchun token (CMC_TOKEN, ACCESS_TOKEN emas)
//
// Parol to'g'ri bo'lsagina host+token qaytariladi — noto'g'ri bo'lsa hech narsa oshkor bo'lmaydi.

const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Faqat POST" });
    return;
  }

  const { password } = req.body || {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Parol kerak" });
    return;
  }

  const expectedHashHex = process.env.PASSWORD_HASH;
  const host = process.env.CMC_WS_HOST;
  const token = process.env.CMC_TOKEN;

  if (!expectedHashHex || !host || !token) {
    res.status(500).json({ error: "Server sozlanmagan — Vercel env variable'lar to'liq emas" });
    return;
  }

  const gotHash = crypto.createHash("sha256").update(password, "utf8").digest();
  let expectedHash;
  try {
    expectedHash = Buffer.from(expectedHashHex, "hex");
  } catch (e) {
    res.status(500).json({ error: "PASSWORD_HASH noto'g'ri formatda" });
    return;
  }

  const match =
    gotHash.length === expectedHash.length && crypto.timingSafeEqual(gotHash, expectedHash);

  if (!match) {
    // Ataylab kichik kechikish — parol brute-force qilishni sekinlashtiradi.
    await new Promise((r) => setTimeout(r, 300));
    res.status(401).json({ error: "Parol xato" });
    return;
  }

  res.status(200).json({ host, token });
};
