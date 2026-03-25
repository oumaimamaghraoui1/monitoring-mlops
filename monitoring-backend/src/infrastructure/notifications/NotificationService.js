import axios from "axios";

function mapSeverity(severity) {
  const s = String(severity || "").toUpperCase();

  switch (s) {
    case "LOW":
      return "INFO";
    case "MEDIUM":
      return "WARNING";
    case "HIGH":
      return "ERROR";
    case "CRITICAL":
      // keep ERROR here because many CF resource-event producers
      // only accept INFO / WARNING / ERROR
      return "ERROR";
    default:
      return "WARNING";
  }
}

async function getToken() {
  const TOKEN_URL = process.env.MONITORING_ANS_TOKEN_URL;
  const CLIENT_ID = process.env.MONITORING_ANS_CLIENT_ID;
  const CLIENT_SECRET = process.env.MONITORING_ANS_CLIENT_SECRET;

  if (!TOKEN_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Missing MONITORING_ANS_TOKEN_URL / MONITORING_ANS_CLIENT_ID / MONITORING_ANS_CLIENT_SECRET"
    );
  }

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");

  const { data } = await axios.post(TOKEN_URL, params, {
    auth: {
      username: CLIENT_ID,
      password: CLIENT_SECRET
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 10000
  });

  if (!data?.access_token) {
    throw new Error("Failed to get access token from ANS");
  }

  return data.access_token;
}

function normalizeTags(rawTags) {
  if (!rawTags) return undefined;

  // If already a plain object, keep it.
  if (!Array.isArray(rawTags) && typeof rawTags === "object") {
    return rawTags;
  }

  // If array [{name,value}] => convert to object
  if (Array.isArray(rawTags)) {
    const obj = {};
    for (const t of rawTags) {
      if (t?.name) obj[t.name] = t.value;
    }
    return Object.keys(obj).length ? obj : undefined;
  }

  return undefined;
}

async function postEvent(url, token, payload) {
  return axios.post(
    `${url}/cf/producer/v1/resource-events`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );
}

export async function notify(alert) {
  const ANS_API_URL = process.env.MONITORING_ANS_API_URL;

  if (!ANS_API_URL) {
    throw new Error("Missing MONITORING_ANS_API_URL");
  }

  const token = await getToken();

  // -----------------------------
  // Candidate #1 = minimal payload
  // -----------------------------
  const basePayload = {
    eventType: alert.eventType || `runtime.${Date.now()}`,
    severity: mapSeverity(alert.severity),
    category: "ALERT", // force ALERT for this CF endpoint
    subject: alert.subject || "Runtime alert",
    body: alert.body || "Runtime observability alert",
    resource: {
      resourceName: alert.resource?.resourceName || "monitoring-backend",
      resourceType: alert.resource?.resourceType || "application"
    }
  };

  const tags = normalizeTags(
    alert.tags || {
      service: "monitoring-backend",
      environment: process.env.NODE_ENV || "dev"
    }
  );

  // Try minimal accepted shapes in order
  const attempts = [
    tags ? { ...basePayload, tags } : basePayload,
    basePayload
  ];

  let lastError = null;

  for (const payload of attempts) {
    try {
      console.log(
        "[ANS-MONITORING] Sending event:",
        JSON.stringify(payload, null, 2)
      );

      const res = await postEvent(ANS_API_URL, token, payload);

      console.log(
        "[ANS-MONITORING] Event accepted ✅",
        res.status,
        typeof res.data === "object" ? JSON.stringify(res.data) : res.data
      );

      return res.data;
    } catch (e) {
      lastError = e;

      console.error("[ANS-MONITORING] ERROR ❌ FULL RESPONSE:");
      if (e.response) {
        console.error("STATUS:", e.response.status);
        console.error("HEADERS:", e.response.headers);
        console.error("DATA:", JSON.stringify(e.response.data, null, 2));
      } else {
        console.error("ERROR:", e.message);
      }

      // Only retry on 400 validation-like failures
      if (e?.response?.status !== 400) {
        throw e;
      }
    }
  }

  throw lastError;
}
