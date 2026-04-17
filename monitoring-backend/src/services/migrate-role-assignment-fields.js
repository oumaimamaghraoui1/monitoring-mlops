import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const STATE_FILE = path.join(ROOT, "data", "all_config_logs.json");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function firstEmail(value) {
  if (!value) return "";
  const m = String(value).match(EMAIL_RE);
  return m ? m[0].toLowerCase() : "";
}

function normalizeCrud(value, fallback) {
  const v = String(value || fallback || "OTHER").trim().toUpperCase();
  if (v === "CREATE" || v === "UPDATE" || v === "DELETE") {
    return v;
  }
  return "OTHER";
}

function extractCrudFromParsed(parsed) {
  if (!parsed) return "";

  const objectId =
    parsed &&
    parsed.object &&
    parsed.object.id
      ? parsed.object.id
      : {};

  if (objectId.crudType) return objectId.crudType;
  if (objectId.operationType) return objectId.operationType;

  if (Array.isArray(parsed.attributes)) {
    for (const a of parsed.attributes) {
      if (a && a.name === "operation") {
        return a.new || a.old || "";
      }
    }
  }

  return parsed.crudType || "";
}

function cleanTechnicalActorLabel(value) {
  if (!value) return "Unknown";

  const s = String(value).trim();

  const email = firstEmail(s);
  if (email) return email;

  if (s.startsWith("user/")) {
    return s.split("/").pop();
  }

  if (s.includes("|")) {
    const afterPipe = s.split("|")[1] || "";
    return afterPipe.split("!")[0] || afterPipe;
  }

  if (s.startsWith("sb-") && s.includes("!")) {
    return s.replace(/^sb-/, "").split("!")[0] || s;
  }

  return s;
}

function isHumanActor(actorRaw) {
  return (
    typeof actorRaw === "string" &&
    (
