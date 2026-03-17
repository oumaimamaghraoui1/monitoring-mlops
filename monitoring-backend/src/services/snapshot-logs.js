import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const RAW = path.join(rootPath, "data", "all_config_logs.json");
const SNAP = path.join(rootPath, "data", "ml_snapshot.json");

async function snapshot() {

  const raw = await fs.readFile(RAW, "utf8");

  await fs.writeFile(
    SNAP,
    raw
  );

  console.log("✅ Snapshot created");

}

snapshot();