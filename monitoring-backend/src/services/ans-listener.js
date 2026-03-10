// ==============================================
// ans-listener.js
// Receives ANS alerts via webhook
// ==============================================

import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");
const PORT = process.env.PORT || 4000;

const FILE =
  path.join(rootPath, "data", "security_events.json");

// ------------------------------------------
async function saveEvent(event) {

  let existing = [];

  try {
    const raw = await fs.readFile(FILE, "utf8");
    existing = JSON.parse(raw || "[]");
  } catch {}

  existing.unshift({
    subject: event.subject,
    body: event.body,
    time: new Date().toISOString()
  });

  const tmp = FILE + ".tmp";

  await fs.writeFile(
    tmp,
    JSON.stringify(existing.slice(0, 500), null, 2)
  );

  await fs.rename(tmp, FILE);
}

// ------------------------------------------
// ✅ ANS WEBHOOK ENDPOINT
app.post("/ans-webhook", async (req, res) => {

  const alert = req.body;

  console.log("Received ANS Alert:",
    alert.subject
  );

  await saveEvent(alert);

  res.sendStatus(200);
});

// ------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ANS Listener running on port ${PORT}`);
});