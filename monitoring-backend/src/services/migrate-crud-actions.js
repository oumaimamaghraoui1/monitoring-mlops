// =========================================================
// migrate-crud-actions.js
// One-time migration to fix CRUD actions in existing logs
// =========================================================

import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();
const STATE_FILE = path.join(ROOT, "monitoring-backend/data/all_config_logs.json");

// -----------------------------
// Helpers
// -----------------------------

function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function normalizeCrud(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "CREATE" || v === "UPDATE" || v === "DELETE") {
    return v;
  }
  return "OTHER";
}

function extractCrudFromParsed(parsed) {
  if (!parsed) return "";

  // 1️⃣ Best case
  if (parsed.object && parsed.object.id) {
    if (parsed.object.id.crudType) {
      return parsed.object.id.crudType;
    }
    if (parsed.object.id.operationType) {
      return parsed.object.id.operationType;
    }
  }

  // 2️⃣ Attributes fallback
  if (Array.isArray(parsed.attributes)) {
    for (const a of parsed.attributes) {
      if (a && a.name === "operation") {
        return a.new || a.old || "";
      }
    }
  }

  // 3️⃣ Generic fallback
  return parsed.crudType || "";
}

// -----------------------------
// Migration
// -----------------------------

async function migrate() {
  console.log("🔧 CRUD Migration starting…");

  const raw = await fs.readFile(STATE_FILE, "utf8");
  const logs = JSON.parse(raw);

  if (!Array.isArray(logs)) {
    throw new Error("Invalid log file format");
  }

  let changed = 0;
  const stats = { CREATE: 0, UPDATE: 0, DELETE: 0, OTHER: 0 };

  for (const log of logs) {
    const parsed = safeParseJson(log.raw && log.raw.message);
    const crudRaw = extractCrudFromParsed(parsed);
    const normalized = normalizeCrud(crudRaw);

    if (log.action !== normalized) {
      log.action = normalized;
      changed++;
    }

    stats[normalized] = (stats[normalized] || 0) + 1;
  }

  // Atomic write
  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(logs, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);

  console.log("✅ Migration finished");
  console.log("✏️ Actions corrected:", changed);
  console.log("📊 Final CRUD counts:", stats);
}

// -----------------------------
migrate().catch(err => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
