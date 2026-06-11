import { Router } from "express";
import PDFDocument from "pdfkit";

const router = Router();

function formatUptime(seconds) {
  seconds = Math.floor(Number(seconds || 0));

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs} sec`;
}

function buildRecommendation(data) {
  const cause = data.detectedCause || "";
  const healthScore = Number(data.healthScore || 0);
  const cpu = Number(data.cpu || 0);
  const resp = Number(data.responseTimeMs || 0);
  const lag = Number(data.elLagMs || 0);
  const heap = Number(data.heapGrowthRate || 0);

  if (cause === "CPU_SATURATION" || cpu > 85) {
    return "The backend is currently showing signs of CPU saturation. Recommended next steps are to review CPU-intensive endpoints, inspect concurrency spikes, and consider scaling or workload redistribution if the condition persists.";
  }

  if (cause === "MEMORY_PRESSURE" || heap > 2) {
    return "The runtime indicates memory pressure or sustained heap growth. Recommended action is to inspect allocation behaviour, investigate possible memory leaks, and review garbage collection efficiency over a longer observation window.";
  }

  if (cause === "QUERY_LATENCY" || resp > 800) {
    return "The dominant signal is high response latency. This usually points to slow downstream dependencies, expensive queries, or request congestion. The priority should be reviewing high-latency routes and dependency timing.";
  }

  if (cause === "REQUEST_BACKLOG" || lag > 200) {
    return "The event loop lag indicates possible request backlog or blocking operations on the main thread. Recommended next steps are to inspect synchronous processing and long-running handlers.";
  }

  if (healthScore < 40) {
    return "The global health score is critical. A broader runtime degradation is in progress and immediate technical review is recommended across CPU, latency, event loop, and memory indicators.";
  }

  if (healthScore < 80) {
    return "The system is in a neutral state. Continued observation is recommended, together with correlation against recent traffic changes and anomaly persistence.";
  }

  return "The backend is currently healthy. No urgent corrective action is required, but the current baseline can be used as a reference for future anomaly comparison.";
}

function drawCard(doc, x, y, w, h, title, main, sub, color = "#0F172A", fill = "#F8FAFC") {
  doc.save();
  doc.roundedRect(x, y, w, h, 12).fillAndStroke(fill, "#D7E0EA");
  doc.restore();

  doc.fillColor("#475569")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(title, x + 12, y + 12, {
      width: w - 24,
      lineBreak: false
    });

  doc.fillColor(color)
    .font("Helvetica-Bold")
    .fontSize(21)
    .text(String(main), x + 12, y + 34, {
      width: w - 24,
      lineBreak: false
    });

  if (sub) {
    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(9)
      .text(sub, x + 12, y + 60, {
        width: w - 24,
        height: h - 62
      });
  }
}

function drawSummaryBox(doc, title, lines, x, y, w, h, borderColor = "#CBD5E1", fill = "#F8FAFC") {
  doc.save();
  doc.roundedRect(x, y, w, h, 12).fillAndStroke(fill, borderColor);
  doc.restore();

  doc.fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(title, x + 14, y + 14, {
      width: w - 28,
      lineBreak: false
    });

  let cy = y + 38;

  lines.forEach((line) => {
    doc.fillColor("#334155")
      .font("Helvetica")
      .fontSize(10)
      .text("• " + line, x + 16, cy, {
        width: w - 32,
        height: 34
      });

    cy += 18;
  });
}

function truncateText(text, max = 38) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function drawFooter(doc) {
  const footerY = doc.page.height - 70;

  doc.save();

  doc.fillColor("#64748B")
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      "Generated automatically by the Monitoring Intelligence Suite.",
      30,
      footerY,
      {
        width: 524,
        height: 12,
        lineBreak: false
      }
    );

  doc.restore();
}

function drawIncidentTablePage(doc, events, pageIndex, totalPages) {
  doc.addPage();

  doc.fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("Recent Incident Timeline", 30, 28, {
      width: 524,
      lineBreak: false
    });

  doc.fillColor("#64748B")
    .font("Helvetica")
    .fontSize(10)
    .text(`Page ${pageIndex} of ${totalPages}`, 30, 52, {
      width: 524,
      lineBreak: false
    });

  const cols = {
    time: 30,
    type: 88,
    sev: 180,
    cause: 245,
    score: 365,
    summary: 420
  };

  let tableY = 86;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827");
  doc.text("Time", cols.time, tableY, { width: 50, lineBreak: false });
  doc.text("Type", cols.type, tableY, { width: 85, lineBreak: false });
  doc.text("Severity", cols.sev, tableY, { width: 58, lineBreak: false });
  doc.text("Cause", cols.cause, tableY, { width: 112, lineBreak: false });
  doc.text("Score", cols.score, tableY, { width: 48, lineBreak: false });
  doc.text("Summary", cols.summary, tableY, { width: 130, lineBreak: false });

  tableY += 14;

  doc.moveTo(30, tableY)
    .lineTo(554, tableY)
    .strokeColor("#CBD5E1")
    .stroke();

  tableY += 8;

  events.forEach(function (ev, idx) {
    if (idx % 2 === 0) {
      doc.save();
      doc.rect(30, tableY - 3, 524, 20).fill("#F8FAFC");
      doc.restore();
    }

    doc.fillColor("#334155").font("Helvetica").fontSize(8);

    doc.text(truncateText(ev.timestamp || "", 10), cols.time, tableY, {
      width: 50,
      lineBreak: false
    });

    doc.text(truncateText(ev.alertType || "", 15), cols.type, tableY, {
      width: 85,
      lineBreak: false
    });

    doc.text(truncateText(ev.severity || "", 10), cols.sev, tableY, {
      width: 58,
      lineBreak: false
    });

    doc.text(truncateText(ev.detectedCause || "", 18), cols.cause, tableY, {
      width: 112,
      lineBreak: false
    });

    doc.text(truncateText(ev.healthScore || "", 8), cols.score, tableY, {
      width: 48,
      lineBreak: false
    });

    doc.text(truncateText(ev.summary || "", 25), cols.summary, tableY, {
      width: 130,
      lineBreak: false
    });

    tableY += 22;
  });

  drawFooter(doc);
}

router.post("/export/pdf", function (req, res) {
  try {
    let payload = req.body || {};

    console.log("[SYSTEM HEALTH PDF EXPORT] content-type:", req.headers["content-type"]);
    console.log("[SYSTEM HEALTH PDF EXPORT] body keys:", Object.keys(payload || {}));

    if (payload && typeof payload.payload === "string") {
      try {
        payload = JSON.parse(payload.payload);
      } catch (parseErr) {
        console.error("[SYSTEM HEALTH PDF EXPORT] Failed to parse form payload:", parseErr);
        return res.status(400).send("Invalid PDF payload");
      }
    }

    if (!payload || typeof payload !== "object") {
      console.error("[SYSTEM HEALTH PDF EXPORT] Missing payload:", payload);
      return res.status(400).send("Missing PDF payload");
    }

    if (!payload.runtime || Object.keys(payload.runtime || {}).length === 0) {
      console.error("[SYSTEM HEALTH PDF EXPORT] Empty runtime payload received:", payload);
      return res.status(400).send("Empty runtime payload received by PDF export");
    }

    const runtime = payload.runtime || {};
    const operations = payload.operations || {};
    const events = Array.isArray(payload.events) ? payload.events : [];

    console.log("[SYSTEM HEALTH PDF EXPORT] runtime received:", runtime);
    console.log("[SYSTEM HEALTH PDF EXPORT] operations received:", operations);
    console.log("[SYSTEM HEALTH PDF EXPORT] events count:", events.length);

    const cpu = Number(runtime.cpu || 0);
    const rss = Number(runtime.rss || 0);
    const rssMb = rss / 1024 / 1024;
    const responseTimeMs = Number(runtime.responseTimeMs || 0);
    const gcTimeMs = Number(runtime.gcTimeMs || 0);
    const heapGrowthRate = Number(runtime.heapGrowthRate || 0);
    const healthScore = Number(runtime.healthScore || 0);
    const uptimeSec = Number(runtime.uptimeSec || 0);
    const elLagMs = Number(runtime.elLagMs || 0);
    const detectedCauseText = runtime.detectedCauseText || runtime.detectedCause || "N/A";

    const recommendation = buildRecommendation(runtime);

    let severity = "Healthy";
    let severityColor = "#16A34A";
    let severityFill = "#DCFCE7";

    if (healthScore < 40) {
      severity = "Critical";
      severityColor = "#DC2626";
      severityFill = "#FEE2E2";
    } else if (healthScore < 80) {
      severity = "Neutral";
      severityColor = "#CA8A04";
      severityFill = "#FEF3C7";
    }

    const findings = [
      `The current backend health score is ${healthScore.toFixed(0)}%, classified as ${severity.toLowerCase()}.`,
      `The dominant root-cause signal is "${detectedCauseText}".`,
      `CPU usage is ${cpu.toFixed(1)}%, memory RSS is ${rssMb.toFixed(1)} MB, and response time is ${responseTimeMs.toFixed(0)} ms.`,
      `Event loop lag is ${elLagMs.toFixed(0)} ms and GC duration is ${gcTimeMs.toFixed(2)} ms.`,
      `Heap growth rate is ${heapGrowthRate.toFixed(2)} MB/min with uptime currently at ${formatUptime(uptimeSec)}.`
    ];

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="backend-health-ai-summary.pdf"');

    const doc = new PDFDocument({
      size: "A4",
      margin: 28,
      autoFirstPage: true
    });

    doc.pipe(res);

    // =====================================================
    // PAGE 1 - EXECUTIVE SUMMARY
    // =====================================================
    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(24)
      .text("Backend Health AI Summary", 30, 28, {
        align: "center",
        width: 535,
        lineBreak: false
      });

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Generated on ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
        30,
        58,
        {
          align: "center",
          width: 535,
          lineBreak: false
        }
      );

    drawCard(
      doc,
      430,
      88,
      120,
      72,
      "Current Status",
      severity,
      detectedCauseText,
      severityColor,
      severityFill
    );

    drawSummaryBox(
      doc,
      "Executive Findings",
      findings,
      30,
      88,
      380,
      140,
      "#CBD5E1",
      "#F8FAFC"
    );

    const cardY = 248;

    drawCard(doc, 30, cardY, 122, 88, "Health Score", `${healthScore.toFixed(0)}%`, "Overall runtime condition", "#0EA5E9");
    drawCard(doc, 164, cardY, 122, 88, "CPU Usage", `${cpu.toFixed(1)}%`, "Backend processing load", "#2563EB");
    drawCard(doc, 298, cardY, 122, 88, "Memory RSS", `${rssMb.toFixed(1)} MB`, "Node.js RAM usage", "#7C3AED");
    drawCard(doc, 432, cardY, 122, 88, "Latency", `${responseTimeMs.toFixed(0)} ms`, "Backend response time", "#F97316");

    const cardY2 = 350;

    drawCard(doc, 30, cardY2, 122, 88, "Event Loop", `${elLagMs.toFixed(0)} ms`, "Main thread delay", "#EA580C");
    drawCard(doc, 164, cardY2, 122, 88, "GC Duration", `${gcTimeMs.toFixed(2)} ms`, "Garbage collection", "#DC2626");
    drawCard(doc, 298, cardY2, 122, 88, "Heap Growth", `${heapGrowthRate.toFixed(2)}`, "MB/min growth rate", "#9333EA");
    drawCard(doc, 432, cardY2, 122, 88, "Uptime", formatUptime(uptimeSec), "Runtime stability window", "#16A34A");

    drawSummaryBox(
      doc,
      "AI Recommendation",
      [recommendation],
      30,
      454,
      524,
      110,
      "#BFDBFE",
      "#EFF6FF"
    );

    drawFooter(doc);

    // =====================================================
    // PAGE 2 - OPERATIONAL ASSESSMENT
    // =====================================================
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("Operational Runtime Assessment", 30, 28, {
        width: 524,
        lineBreak: false
      });

    drawSummaryBox(
      doc,
      "Runtime Interpretation",
      [
        `Health score indicates a ${severity.toLowerCase()} operating state.`,
        `Detected cause is currently evaluated as ${detectedCauseText}.`,
        `Incidents today: ${Number(operations.incidentsToday || 0)}.`,
        `Alerts triggered: ${Number(operations.alertsTriggered || 0)}.`
      ],
      30,
      60,
      524,
      110
    );

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Detailed Runtime Metrics", 30, 190, {
        width: 524,
        lineBreak: false
      });

    const metricRows = [
      ["Health Score", `${healthScore.toFixed(0)} %`],
      ["CPU Usage", `${cpu.toFixed(1)} %`],
      ["Memory RSS", `${rssMb.toFixed(1)} MB`],
      ["Response Time", `${responseTimeMs.toFixed(0)} ms`],
      ["Event Loop Lag", `${elLagMs.toFixed(0)} ms`],
      ["GC Duration", `${gcTimeMs.toFixed(2)} ms`],
      ["Heap Growth Rate", `${heapGrowthRate.toFixed(2)} MB/min`],
      ["Uptime", formatUptime(uptimeSec)],
      ["Detected Cause", detectedCauseText],
      ["Severity", severity],
      ["Incidents Today", `${Number(operations.incidentsToday || 0)}`],
      ["Alerts Triggered", `${Number(operations.alertsTriggered || 0)}`],
      ["Last Anomaly", operations.lastAnomalyText || "No anomaly yet"],
      ["Incident Streak", `${Number(operations.incidentStreak || 0)}`]
    ];

    let y = 220;

    metricRows.forEach(function (row, idx) {
      if (idx % 2 === 0) {
        doc.save();
        doc.roundedRect(30, y - 4, 524, 24, 6).fill("#F8FAFC");
        doc.restore();
      }

      doc.fillColor("#334155")
        .font("Helvetica")
        .fontSize(10)
        .text(row[0], 42, y, {
          width: 200,
          lineBreak: false
        });

      doc.fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(row[1], 260, y, {
          width: 270,
          align: "right",
          lineBreak: false
        });

      y += 28;
    });

    if (!events.length) {
      doc.fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("Recent Incident Timeline", 30, 640, {
          width: 524,
          lineBreak: false
        });

      doc.fillColor("#64748B")
        .font("Helvetica")
        .fontSize(10)
        .text("No recent incidents recorded.", 30, 668, {
          width: 524,
          lineBreak: false
        });
    } else {
      doc.fillColor("#111827")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text("Recent Incident Timeline", 30, 640, {
          width: 524,
          lineBreak: false
        });

      doc.fillColor("#64748B")
        .font("Helvetica")
        .fontSize(10)
        .text(`${events.length} incident(s) included on the following page(s).`, 30, 668, {
          width: 524,
          lineBreak: false
        });
    }

    drawFooter(doc);

    // =====================================================
    // PAGE 3+ - INCIDENTS, PAGINATED SAFELY
    // =====================================================
    if (events.length) {
      const rowsPerPage = 28;
      const pages = [];

      for (let i = 0; i < events.length; i += rowsPerPage) {
        pages.push(events.slice(i, i + rowsPerPage));
      }

      pages.forEach(function (pageEvents, idx) {
        drawIncidentTablePage(doc, pageEvents, idx + 1, pages.length);
      });
    }

    doc.end();
  } catch (err) {
    console.error("[SYSTEM HEALTH PDF EXPORT] Failed:", err);
    res.status(500).send("System health PDF export failed");
  }
});

export default router;