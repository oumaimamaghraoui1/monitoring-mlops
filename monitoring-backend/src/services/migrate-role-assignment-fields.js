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

  // user/sap.default/foo@bar.com -> foo@bar.com
  if (s.startsWith("user/")) {
    return s.split("/").pop();
  }

  // sb-xxx|portal-cf-service!b3664 -> portal-cf-service
  if (s.includes("|")) {
    const afterPipe = s.split("|")[1] || "";
    return afterPipe.split("!")[0] || afterPipe;
  }

  // sb-das-application!b188376 -> das-application
  if (s.startsWith("sb-") && s.includes("!")) {
    return s.replace(/^sb-/, "").split("!")[0] || s;
  }

  return s;
}

function isHumanActor(actorRaw) {
  return (
    typeof actorRaw === "string" &&
    (
      actorRaw.startsWith("user/") ||
      actorRaw.indexOf("@") > -1
    )
  );
}

function extractScimUserInfo(parsed) {
  if (!parsed || !Array.isArray(parsed.attributes)) {
    return { email: "", name: "" };
  }

  for (const attr of parsed.attributes) {
    if (!attr || attr.name !== "complete") continue;

    for (const payload of [attr.new, attr.old]) {
      if (!payload) continue;

      const obj = safeParseJson(payload);
      if (!obj || typeof obj !== "object") continue;

      let email = "";

      if (Array.isArray(obj.emails)) {
        const first = obj.emails.find((e) => e && e.value);
        if (first && first.value) {
          email = String(first.value).toLowerCase();
        }
      }

      if (!email && obj.externalId) {
        email = firstEmail(obj.externalId);
      }

      if (!email) {
        email = firstEmail(payload);
      }

      const nameObj = obj.name || {};
      const name =
        nameObj.formatted ||
        [nameObj.givenName, nameObj.familyName].filter(Boolean).join(" ");

      if (email || name) {
        return {
          email: email || "",
          name: name || ""
        };
      }
    }
  }

  return { email: "", name: "" };
}

function buildGenericDetails(parsed, currentDetails) {
  const d = String(currentDetails || "").trim();

  // on garde seulement les détails utiles non pollués
  if (
    d &&
    d.indexOf("Assigned role: ") !== 0 &&
    d.indexOf("User identity updated") !== 0
  ) {
    return d;
  }

  const objectNode = parsed?.object || {};
  const objectId = objectNode.id || {};
  const tableName = objectId.tableName || "";
  const objectTypeRaw = objectNode.type || "";

  if (objectTypeRaw === "Deployment") return "Deployment";
  if (objectTypeRaw === "Undeployment") return "Undeployment";
  if (objectTypeRaw === "Redeployment") return "Redeployment";

  if (tableName) return `Configuration updated (${tableName})`;
  if (objectTypeRaw) return `Configuration updated (${objectTypeRaw})`;

  return "Configuration updated";
}

function isExplicitRoleAssignment(parsed) {
  const objectNode = parsed?.object || {};
  const objectId = objectNode.id || {};
  const objectTypeRaw = objectNode.type || "";
  const tableName = objectId.tableName || "";
  const roleName = objectId.rolecollection_name || "";

  return (
    objectTypeRaw === "xs_rolecollection2user" ||
    tableName === "xs_rolecollection2user" ||
    !!roleName
  );
}

async function migrate() {
  console.log("🔧 Migration starting…");

  const raw = await fs.readFile(STATE_FILE, "utf8");
  const logs = JSON.parse(raw || "[]");

  if (!Array.isArray(logs)) {
    throw new Error("Invalid all_config_logs.json format");
  }

  let changed = 0;

  for (const log of logs) {
    const parsed = safeParseJson(log.raw && log.raw.message);
    if (!parsed) continue;

    const objectNode = parsed.object || {};
    const objectId = objectNode.id || {};
    const objectTypeRaw = objectNode.type || "";
    const roleName = objectId.rolecollection_name || "";

    const actorRaw = log.actor || (log.raw && log.raw.user) || "Unknown";
    const normalizedCrud = normalizeCrud(
      extractCrudFromParsed(parsed),
      log.action || "OTHER"
    );

    // =====================================================
    // 1) SCIM USER UPDATE FIRST
    // =====================================================
    if (String(objectTypeRaw).toLowerCase() === "scim user") {
      const scim = extractScimUserInfo(parsed);

      const newTarget =
        scim.email ||
        (log.target && log.target !== "Unknown"
          ? log.target
          : cleanTechnicalActorLabel(actorRaw));

      const newDetails =
        scim.name && scim.email
          ? `User identity updated: ${scim.name} (${scim.email})`
          : scim.email
          ? `User identity updated: ${scim.email}`
          : "User identity updated";

      const needsUpdate =
        log.objectType !== "User Profile Update" ||
        log.details !== newDetails ||
        log.target !== newTarget ||
        log.isHuman !== true ||
        log.action !== normalizedCrud;

      if (needsUpdate) {
        log.objectType = "User Profile Update";
        log.details = newDetails;
        log.target = newTarget;
        log.isHuman = true;
        log.action = normalizedCrud;
        changed++;
      }

      continue;
    }

    // =====================================================
    // 2) STRICT ROLE ASSIGNMENT ONLY
    // =====================================================
    if (isExplicitRoleAssignment(parsed)) {
      const newTarget = roleName || log.target || "Role";
      const newDetails = roleName
        ? `Assigned role: ${roleName}`
        : "Role assignment";

      const needsUpdate =
        log.objectType !== "Role Assignment" ||
        log.target !== newTarget ||
        log.details !== newDetails ||
        log.isHuman !== true ||
        log.action !== normalizedCrud;

      if (needsUpdate) {
        log.objectType = "Role Assignment";
        log.target = newTarget;
        log.details = newDetails;
        log.isHuman = true;
        log.action = normalizedCrud;
        changed++;
      }

      continue;
    }

    // =====================================================
    // 3) GENERIC CONFIG CHANGE
    // =====================================================
    const newDetails = buildGenericDetails(parsed, "");
    const pollutedTarget =
      !log.target ||
      log.target === "Unknown" ||
      String(log.target).indexOf("Configuration updated (") === 0 ||
      String(log.target).indexOf("User identity updated") === 0;

    const newTarget = pollutedTarget ? "Unknown" : log.target;
    const newIsHuman = isHumanActor(actorRaw);

    const needsGenericUpdate =
      log.objectType !== "Configuration Change" ||
      log.details !== newDetails ||
      log.target !== newTarget ||
      log.isHuman !== newIsHuman ||
      log.action !== normalizedCrud;

    if (needsGenericUpdate) {
      log.objectType = "Configuration Change";
      log.details = newDetails;
      log.target = newTarget;
      log.isHuman = newIsHuman;
      log.action = normalizedCrud;
      changed++;
    }
  }

  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(logs, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);

  console.log("✅ Migration finished");
  console.log("✏️ Rows corrected:", changed);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});