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
// Browser -> frontend /backend/metrics/export/pdf
// Frontend -> backend /metrics/export/pdf
// =====================================================
app.post(
  "/backend/metrics/export/pdf",
  express.json({ limit: "10mb" }),
  async (req, res) => {
    console.log("➡ Frontend explicit Health PDF proxy");
    console.log("Target:", `${BACKEND_URL}/metrics/export/pdf`);

    try {
      const response = await fetch(`${BACKEND_URL}/metrics/export/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/pdf"
        },
        body: JSON.stringify(req.body)
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
  }
);

// =====================================================
// Body parser for explicit frontend routes
// =====================================================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// =====================================================
// Explicit AI proxy
// Browser -> frontend /ai/recommend
// Frontend -> backend /ai/recommend
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
      body: JSON.stringify(req.body)
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
    timeout: 120000
  })
);

// Serve built UI5 app
app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback - must be LAST
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Frontend runtime listening on port ${PORT}`);
  console.log(`Proxy /backend -> ${BACKEND_URL}`);
  console.log(`Proxy /ai/recommend -> ${BACKEND_URL}/ai/recommend`);
  console.log(`Redirect /resources -> ${UI5_CDN}/resources`);
});