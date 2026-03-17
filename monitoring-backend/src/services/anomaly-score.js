import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPath = path.resolve(__dirname, "../..");

const pythonPath = path.join(
  rootPath,
  "mlops",
  "venv",
  "bin",
  "python"
);

const scriptPath = path.join(
  rootPath,
  "mlops",
  "inference",
  "score_event.py"
);

export function scoreEvent(event) {

  return new Promise((resolve) => {

    const py = spawn(pythonPath, [scriptPath]);

    let data = "";

    py.stdout.on("data", chunk => {
      data += chunk.toString();
    });

    py.stderr.on("data", err => {
      console.log("❌ PYTHON STDERR:", err.toString());
    });

    py.on("close", () => {

      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch {
        resolve({ score: 0, anomaly: 0 });
      }

    });

    // ✅ SEND JSON VIA STDIN
    py.stdin.write(JSON.stringify(event));
    py.stdin.end();

  });

}