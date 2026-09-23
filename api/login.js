// Vercel serverless — email + parol tekshiradi.
// Environment Variables:
//   LOGIN_EMAIL     — email ning SHA-256 hex hashi (emailning o'zi emas!)
//   PASSWORD_HASH   — parolning SHA-256 hex hashi
//   CMC_WS_HOST     — backend domeni
//   CMC_TOKEN       — brauzer terminali tokeni

import crypto from "crypto";

function sha256hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function safeEqualHex(gotHex, expectedHex) {
  try {
    const a = Buffer.from(gotHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Faqat POST" });
    return;
  }

  const { email, password } = req.body || {};
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    res.status(400).json({ error: "Email va parol kerak" });
    return;
  }

  const expectedEmailHash = process.env.LOGIN_EMAIL;
  const expectedPassHash = process.env.PASSWORD_HASH;
  const host = process.env.CMC_WS_HOST;
  const token = process.env.CMC_TOKEN;

  if (!expectedEmailHash || !expectedPassHash || !host || !token) {
    res.status(500).json({
      error: "Server sozlanmagan — LOGIN_EMAIL, PASSWORD_HASH, CMC_WS_HOST, CMC_TOKEN kerak",
    });
    return;
  }

  const emailHash = sha256hex(email.trim().toLowerCase());
  const passHash = sha256hex(password);

  const emailOk = safeEqualHex(emailHash, expectedEmailHash);
  const passOk = safeEqualHex(passHash, expectedPassHash);

  if (!emailOk || !passOk) {
    await new Promise((r) => setTimeout(r, 300));
    res.status(401).json({ error: "Email yoki parol xato" });
    return;
  }

  res.status(200).json({ host, token });
};
