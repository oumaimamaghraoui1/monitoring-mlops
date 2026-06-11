const express = require("express");
const path = require("path");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = process.env.PORT || 8080;

const BACKEND_URL =
  process.env.BACKEND_URL ||
  "https://monitoring-backend.cfapps.eu10-004.hana.ondemand.com";

const UI5_CDN =
  process.env.UI5_CDN ||
  "https://ui5.sap.com/1.144.1";

// =====================================================
// Body parsers MUST be before explicit POST routes/proxy
// =====================================================
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// =====================================================
// SAPUI5 framework resources fix
// Prevent /resources/sap-ui-core.js from falling back to index.html
// =====================================================
app.use("/resources", (req, res) => {
  const target = `${UI5_CDN}/resources${req.url}`;
  console.log(`Redirect UI5 resource: ${req.originalUrl} -> ${target}`);
  res.redirect(302, target);
});

app.use("/test-resources", (req, res) => {
  const target = `${UI5_CDN}/test-resources${req.url}`;
  console.log(`Redirect UI5 test resource: ${req.originalUrl} -> ${target}`);
  res.redirect(302, target);
});

// =====================================================
// Explicit Health PDF proxy
// Browser  -> frontend /backend/metrics/export/pdf
// Frontend -> backend  /metrics/export/pdf
// =====================================================
app.post("/backend/metrics/export/pdf", async (req, res) => {
  console.log("➡ Frontend explicit Health PDF proxy");
  console.log("Target:", `${BACKEND_URL}/metrics/export/pdf`);
  console.log("Frontend PDF content-type:", req.headers["content-type"]);
  console.log("Frontend PDF body keys:", Object.keys(req.body || {}));

  try {
    let payload = req.body || {};

    // Support old form-based payload:
    // { payload: "{...json string...}" }
    if (payload && typeof payload.payload === "string") {
      try {
        payload = JSON.parse(payload.payload);
      } catch (parseErr) {
        console.error("❌ Frontend PDF proxy failed to parse payload string:", parseErr);

        return res.status(400).json({
          error: "Invalid frontend PDF payload",
          details: parseErr.message
        });
      }
    }

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({
        error: "Missing frontend PDF payload"
      });
    }

    if (!payload.runtime || Object.keys(payload.runtime || {}).length === 0) {
      console.error("❌ Frontend PDF proxy received empty runtime payload:", payload);

      return res.status(400).json({
        error: "Empty runtime payload received by frontend PDF proxy",
        bodyKeys: Object.keys(payload || {})
      });
    }

    const body = JSON.stringify(payload);

    console.log("Frontend PDF forwarded payload keys:", Object.keys(payload));
    console.log("Frontend PDF forwarded runtime keys:", Object.keys(payload.runtime || {}));
    console.log("Frontend PDF forwarded body length:", body.length);

    const response = await fetch(`${BACKEND_URL}/metrics/export/pdf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/pdf"
      },
      body: body
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.status(response.status);

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/pdf"
    );

    res.setHeader(
      "Content-Disposition",
      response.headers.get("content-disposition") ||
        'attachment; filename="backend-health-ai-summary.pdf"'
    );

    res.send(buffer);
  } catch (err) {
    console.error("❌ Frontend Health PDF proxy failed:", err);

    res.status(500).json({
      error: "Frontend Health PDF proxy failed",
      backendUrl: BACKEND_URL,
      details: String(err)
    });
  }
});

// =====================================================
// Explicit AI proxy
// Browser  -> frontend /ai/recommend
// Frontend -> backend  /ai/recommend
// =====================================================
app.post("/ai/recommend", async (req, res) => {
  console.log("➡ Frontend proxy POST /ai/recommend");
  console.log("Proxy target:", `${BACKEND_URL}/ai/recommend`);
  console.log("Payload:", req.body);

  try {
    const response = await fetch(`${BACKEND_URL}/ai/recommend`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body || {})
    });

    const text = await response.text();

    res.status(response.status);

    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (err) {
    console.error("Frontend AI proxy error:", err);

    res.status(500).json({
      error: "Frontend failed to reach backend AI",
      backendUrl: BACKEND_URL,
      details: String(err)
    });
  }
});

app.get("/ai/health", async (_req, res) => {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    const text = await response.text();

    res.status(response.status);

    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (err) {
    res.status(500).json({
      error: "Frontend failed to reach backend health",
      backendUrl: BACKEND_URL,
      details: String(err)
    });
  }
});

// =====================================================
// Generic backend proxy
// /backend/xxx -> BACKEND_URL/xxx
// =====================================================
// Important:
// Because express.json() is enabled above, parsed bodies must be re-written
// for proxied POST/PUT/PATCH requests, otherwise http-proxy-middleware can
// forward an empty body.
app.use(
  "/backend",
  createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    secure: false,
    pathRewrite: {
      "^/backend": ""
    },
    logLevel: "debug",
    proxyTimeout: 120000,
    timeout: 120000,

    onProxyReq: (proxyReq, req, _res) => {
      if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
        const bodyData = JSON.stringify(req.body);

        proxyReq.setHeader("Content-Type", "application/json");
        proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyData));

        proxyReq.write(bodyData);

        console.log(
          "[GENERIC BACKEND PROXY] forwarded body keys:",
          Object.keys(req.body || {})
        );
        console.log(
          "[GENERIC BACKEND PROXY] forwarded body length:",
          bodyData.length
        );
      }
    }
  })
);

// =====================================================
// Serve built UI5 app
// =====================================================
app.use(express.static(path.join(__dirname, "dist")));

// =====================================================
// SPA fallback - must be LAST
// =====================================================
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Frontend runtime listening on port ${PORT}`);
  console.log(`Proxy /backend -> ${BACKEND_URL}`);
  console.log(`Proxy /ai/recommend -> ${BACKEND_URL}/ai/recommend`);
  console.log(`Redirect /resources -> ${UI5_CDN}/resources`);
});