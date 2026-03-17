import { scoreEvent } from "./anomaly-score.js";

const fakeEvent = {
  actor: "test-user",
  objectType: "role",
  time: new Date().toISOString()
};

try {
  const score = scoreEvent(fakeEvent);

  if (typeof score !== "number" || isNaN(score)) {
    throw new Error("Invalid anomaly score");
  }

  console.log("✅ Anomaly scoring works:", score);
} catch (err) {
  console.error("❌ Anomaly scoring failed:", err);
  process.exit(1);
}