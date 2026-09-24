// Terminal / WebSocket login O‘CHIRILGAN.
// Brauzerda faqat MCP (/api/mcp-url). Shell/terminal yo‘q.

export default async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.status(403).json({
    error: "Brauzer terminali o‘chirilgan. Faqat MCP ishlatiladi (/api/mcp-url).",
  });
};
