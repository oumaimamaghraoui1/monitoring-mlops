import dotenv from "dotenv";
dotenv.config({ path: process.cwd() + "/.env" });

import axios from "axios";



const { ANS_USERNAME, ANS_PASSWORD, ANS_API_URL } = process.env;

async function sendTestEvent() {
  const event = {
    eventType: "custom.security.adminRoleAssigned",
    severity: "WARNING",
    category: "ALERT",
    subject: "TEST – Admin role assigned",
    body: "This is a test event sent from the backend to validate email delivery.",
    resource: {
      resourceName: "monitoring-backend",
      resourceType: "application"
    }
  };

  await axios.post(
    `${ANS_API_URL}/cf/producer/v1/resource-events`,
    event,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Basic " +
          Buffer.from(`${ANS_USERNAME}:${ANS_PASSWORD}`).toString("base64"),
      },
    }
  );

  console.log("✔ Test event sent!");
}

sendTestEvent().catch((e) => {
  console.error("❌ Error:", e.response?.data || e.message);
});