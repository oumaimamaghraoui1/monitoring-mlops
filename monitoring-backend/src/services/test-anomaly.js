import { scoreEvent } from "./anomaly-score.js";

const fakeEvent = {
  hour: 12,
  day: 3,
  weekend: 0,
  actor_count_7d: 5,
  actor_object_7d: 2,
  time_since_last_actor: 3600,
  first_time_role: 0
};

async function test() {

  try {

    const result = await scoreEvent(fakeEvent);

    if (
      !result ||
      typeof result.score !== "number" ||
      isNaN(result.score)
    ) {
      throw new Error("Invalid anomaly score");
    }

    console.log("✅ Anomaly scoring works:", result);

  } catch (err) {

    console.error("❌ Anomaly scoring failed:", err);
    process.exit(1);

  }
}

test();