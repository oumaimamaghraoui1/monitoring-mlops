import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootPath, ".env") });

const {
  ALM_USERNAME,
  ALM_PASSWORD,
  ALM_OAUTH_URL,
  ALM_API_URL
} = process.env;

// =========================================================
// FILE PATHS
// =========================================================

const STATE_DIR = path.join(rootPath, "data");
const STATE_FILE = path.join(
  STATE_DIR,
  "data_access_and_modification.json"
);

// =========================================================
// CONFIG
// =========================================================

// fetch per poll
const POLL_TOP = 3000;

// polling every 2 minutes
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// ✅ KEEP ONLY LAST 14 DAYS
const RETENTION_DAYS = 14;
const RETENTION_MS =
  RETENTION_DAYS * 24 * 60 * 60 * 1000;

// =========================================================
// HELPERS
// =========================================================

async function ensureStateFile() {
  await fs.mkdir(STATE_DIR, { recursive: true });

  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(
      STATE_FILE,
      "[]",
      "utf8"
    );
  }
}

async function loadState() {
  try {
    await ensureStateFile();
    const raw =
      await fs.readFile(
        STATE_FILE,
        "utf8"
      );

    const logs =
      JSON.parse(raw || "[]");

    return Array.isArray(logs)
      ? logs
      : [];
  } catch {
    return [];
  }
}

async function saveState(logs) {
  const tmp =
    STATE_FILE + ".tmp";

  await fs.writeFile(
    tmp,
    JSON.stringify(logs, null, 2),
    "utf8"
  );

  await fs.rename(
    tmp,
    STATE_FILE
  );
}

// =========================================================
// TOKEN
// =========================================================

async function getToken() {

  const params =
    new URLSearchParams({
      grant_type:
        "client_credentials",
      client_id:
        ALM_USERNAME,
      client_secret:
        ALM_PASSWORD
    });

  const { data } =
    await axios.post(
      ALM_OAUTH_URL,
      params,
      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        }
      }
    );

  return data.access_token;
}

// =========================================================
// FETCH CATEGORY
// =========================================================

async function fetchCategory(
  tok,
  category
) {

  const url =
    `${ALM_API_URL}/auditlog/v2/auditlogrecords` +
    `?category=${category}` +
    `&$orderby=time%20desc` +
    `&$top=${POLL_TOP}`;

  const { data } =
    await axios.get(url, {
      headers: {
        Authorization:
          `Bearer ${tok}`
      }
    });

  return Array.isArray(data)
    ? data
    : [];
}

// =========================================================
// POLL LOGIC
// =========================================================

async function pollOnce() {

  console.log(
    "-------------------------------------------------"
  );
  console.log(
    "[POLL] Monitoring last 14 days logs…"
  );

  const now =
    Date.now();

  const cutoff =
    now - RETENTION_MS;

  // ✅ LOAD EXISTING
  let existing =
    await loadState();

  // ✅ REMOVE LOGS OLDER THAN 14 DAYS
  existing =
    existing.filter(log => {

      const t =
        new Date(
          log.time
        ).getTime();

      return (
        !isNaN(t) &&
        t >= cutoff
      );
    });

  console.log(
    `[POLL] After cleanup: ${existing.length}`
  );

  const tok =
    await getToken();

  const logsAccess =
    await fetchCategory(
      tok,
      "audit.data-access"
    );

  const logsMod =
    await fetchCategory(
      tok,
      "audit.data-modification"
    );

  console.log(
    `[POLL] data-access: ${logsAccess.length}`
  );

  console.log(
    `[POLL] data-modification: ${logsMod.length}`
  );

  const combined =
    [
      ...logsAccess,
      ...logsMod,
      ...existing
    ];

  const merged = [];
  const seen =
    new Set();

  for (
    const raw of combined
  ) {

    const key =
      raw.message_uuid ||
      `${raw.category}|${raw.time}|${raw.id || ""}`;

    if (
      seen.has(key)
    )
      continue;

    seen.add(key);

    const logTime =
      new Date(
        raw.time ||
        raw?.raw?.time
      ).getTime();

    // ✅ KEEP ONLY LAST 14 DAYS
    if (
      isNaN(
        logTime
      ) ||
      logTime <
        cutoff
    )
      continue;

    merged.push({
      uuid:
        raw.message_uuid ||
        key,
      time:
        raw.time,
      category:
        raw.category,
      raw:
        raw.raw ||
        raw
    });
  }

  merged.sort(
    (a, b) =>
      new Date(
        b.time
      ) -
      new Date(
        a.time
      )
  );

  await saveState(
    merged
  );

  console.log(
    `[POLL] Saved ${merged.length} logs (last 14 days)`
  );
}

// =========================================================
// RUN
// =========================================================

async function main() {
  await pollOnce();

  setInterval(
    pollOnce,
    POLL_INTERVAL_MS
  );
}

main().catch(
  err =>
    console.error(err)
);