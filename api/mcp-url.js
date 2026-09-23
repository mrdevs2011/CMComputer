// Email + parol to'g'ri bo'lsa Claude MCP URL ni qaytaradi.
// Environment Variables:
//   LOGIN_EMAIL     — email SHA-256 hex
//   PASSWORD_HASH   — parol SHA-256 hex
//   CMC_WS_HOST     — ngrok host
//   ACCESS_TOKEN    — MCP token (yoki MCP_TOKEN)

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

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
  const accessToken = process.env.ACCESS_TOKEN || process.env.MCP_TOKEN;

  if (!expectedEmailHash || !expectedPassHash || !host || !accessToken) {
    res.status(500).json({
      error: "Server sozlanmagan — LOGIN_EMAIL, PASSWORD_HASH, CMC_WS_HOST, ACCESS_TOKEN kerak",
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

  const cleanHost = String(host).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const mcpUrl = `https://${cleanHost}/mcp?token=${accessToken}`;

  res.status(200).json({ url: mcpUrl, host: cleanHost });
};
