// CMC Login API — handles auth for MCP and Shell

import crypto from "crypto";

function sha256hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function cleanVal(v) {
  let s = String(v || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function safeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function safeEqualHex(gotHex, expectedHex) {
  try {
    const a = Buffer.from(gotHex, "hex");
    const b = Buffer.from(expectedHex, "hex");
    return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function checkEmail(inputEmail, envList) {
  const input = cleanVal(inputEmail).toLowerCase();
  if (!input) return false;
  const inputUser = input.split("@")[0];

  for (const raw of envList) {
    const env = cleanVal(raw);
    if (!env) continue;

    // 1. Plain text email match (case-insensitive)
    if (input === env.toLowerCase()) return true;

    // 2. Username part match (e.g. mrdevs2011 vs mrdevs2011@gmail.com)
    const envUser = env.toLowerCase().split("@")[0];
    if (inputUser && envUser && inputUser === envUser) return true;

    // 3. SHA-256 hash match (full email or username part)
    if (env.length === 64) {
      if (safeEqualHex(sha256hex(input), env.toLowerCase())) return true;
      if (safeEqualHex(sha256hex(inputUser), env.toLowerCase())) return true;
    }
  }
  return false;
}

function checkPassword(inputPass, envList) {
  const input = String(inputPass || "");
  if (!input) return false;

  for (const raw of envList) {
    const env = cleanVal(raw);
    if (!env) continue;

    // 1. Plain text direct match
    if (safeEqualString(input, env) || input === env) return true;

    // 2. SHA-256 hash match
    if (env.length === 64) {
      if (safeEqualHex(sha256hex(input), env.toLowerCase())) return true;
    }
  }
  return false;
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
    res.status(400).json({ error: "Email va parol kiritilishi shart" });
    return;
  }

  const envEmails = [
    process.env.LOGIN_EMAIL,
    process.env.EMAIL,
    process.env.ADMIN_EMAIL,
    process.env.USER_EMAIL,
    process.env.USERNAME,
  ].filter(Boolean);

  const envPasswords = [
    process.env.PASSWORD_HASH,
    process.env.PASSWORD,
    process.env.LOGIN_PASSWORD,
    process.env.ADMIN_PASSWORD,
    process.env.CMC_PASSWORD,
    process.env.CMC_TOKEN,
    process.env.ACCESS_TOKEN,
    process.env.MCP_TOKEN,
  ].filter(Boolean);

  // If any credentials are configured in environment variables, validate against them
  if (envEmails.length > 0 || envPasswords.length > 0) {
    const emailOk = envEmails.length === 0 || checkEmail(email, envEmails);
    const passOk = envPasswords.length === 0 || checkPassword(password, envPasswords);

    if (!emailOk || !passOk) {
      await new Promise((r) => setTimeout(r, 200));
      res.status(401).json({
        ok: false,
        error: !emailOk ? "Email yoki username noto'g'ri" : "Parol yoki sessiya tokeni xato",
      });
      return;
    }
  }

  const host = process.env.CMC_WS_HOST || req.headers.host;
  const token = process.env.CMC_TOKEN || process.env.ACCESS_TOKEN || process.env.MCP_TOKEN;
  const cleanHost = String(host || req.headers.host || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const effectiveToken = token || password;
  const mcpUrl = `https://${cleanHost}/mcp?token=${effectiveToken}`;

  res.status(200).json({
    ok: true,
    host: cleanHost,
    token: effectiveToken,
    mcpUrl,
    url: mcpUrl,
  });
};
