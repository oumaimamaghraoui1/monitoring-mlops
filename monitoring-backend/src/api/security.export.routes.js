import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import axios from "axios";

const router = Router();
const API_BASE = "http://localhost:8090";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// =====================================================
// SAME DATA SOURCE AS UI
// =====================================================
async function loadSecurityLogs() {
  const { data } = await axios.get(`${API_BASE}/security/events`);
  const logs = Array.isArray(data.logs) ? data.logs : [];
  return {
    logs,
    lastAuditDate: data.lastAuditDate || ""
  };
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);

  const pad = (n) => String(n).padStart(2, "0");

  return (
    d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds())
  );
}

function collectNestedStrings(obj, out = []) {
  if (!obj) return out;

  if (typeof obj === "string") {
    out.push(obj);
    return out;
  }

  if (Array.isArray(obj)) {
    obj.forEach((x) => collectNestedStrings(x, out));
    return out;
  }

  if (typeof obj === "object") {
    Object.keys(obj).forEach((k) => collectNestedStrings(obj[k], out));
  }

  return out;
}

function extractEmailDeep(ev) {
  if (ev && ev.user && EMAIL_RE.test(String(ev.user))) {
    const m = String(ev.user).match(EMAIL_RE);
    if (m) {
      return m[0].toLowerCase();
    }
  }

  const strings = collectNestedStrings(ev);

  for (let i = 0; i < strings.length; i++) {
    const m = String(strings[i]).match(EMAIL_RE);
    if (m) {
      return m[0].toLowerCase();
    }
  }

  return "Unknown";
}

function normalizeClient(client) {
  if (!client) {
    return "Unknown";
  }

  const c = String(client).replace(/\"/g, "").trim();

  if (c.indexOf("sb-") > -1 || c.indexOf("|") > -1) {
    const afterPipe = c.split("|")[1];
    const label = afterPipe ? afterPipe.split("!")[0] : c;
    return `${label} (${c})`;
  }

  return c;
}

function extractClientDeep(ev) {
  if (ev && ev.client && ev.client !== "Unknown") {
    return normalizeClient(ev.client);
  }

  const strings = collectNestedStrings(ev);

  for (let i = 0; i < strings.length; i++) {
    const str = String(strings[i]);

    const m =
      /"client_id"\s*:\s*"([^"]+)"/.exec(str) ||
      /"cid"\s*:\s*"([^"]+)"/.exec(str) ||
      /"azp"\s*:\s*"([^"]+)"/.exec(str) ||
      /clientId=([^,\]]+)/.exec(str);

    if (m && m[1]) {
      return normalizeClient(m[1]);
    }

    if (str.indexOf("sb-") > -1 && (str.indexOf("|") > -1 || str.indexOf("!") > -1)) {
      return normalizeClient(str);
    }
  }

  return "Unknown";
}

function cleanOriginField(origin) {
  if (!origin) {
    return "N/A";
  }

  return String(origin);
}

function mapTypeToGroup(t) {
  t = String(t || "").toLowerCase();

  if (
    t.indexOf("userauthenticationsuccess") > -1 ||
    t.indexOf("identityproviderauthenticationsuccess") > -1 ||
    t.indexOf("login") > -1 ||
    t.indexOf("authentication") > -1 ||
    t.indexOf("authsuccess") > -1 ||
    t.indexOf("logon") > -1
  ) {
    if (t.indexOf("client") > -1) {
      return "CLIENT";
    }
    if (t.indexOf("token") > -1) {
      return "TOKEN";
    }
    return "LOGIN";
  }

  if (
    t.indexOf("tokenissuedevent") > -1 ||
    t.indexOf("tokenissued") > -1 ||
    t.indexOf("token") > -1 ||
    t.indexOf("oauth") > -1 ||
    t.indexOf("jwt") > -1
  ) {
    return "TOKEN";
  }

  if (
    t.indexOf("clientauthenticationsuccess") > -1 ||
    t.indexOf("clientauthentication") > -1 ||
    t.indexOf("clientauth") > -1 ||
    t.indexOf("client") > -1
  ) {
    return "CLIENT";
  }

  return "OTHER";
}

function stateFromRisk(risk) {
  if (risk === "High") return "Error";
  if (risk === "Medium") return "Warning";
  if (risk === "Low") return "Information";
  if (risk === "Normal") return "Success";
  return "None";
}

function normalizeValueState(state) {
  if (state === "Error") return "Error";
  if (state === "Warning") return "Warning";
  if (state === "Success") return "Success";
  if (state === "Information") return "Information";
  if (state === "Critical") return "Warning";
  return "None";
}

function riskFromNormalizedScore(score, anomaly, backendRisk) {
  const s = Number(score || 0);
  const a = Number(anomaly || 1);

  if (
    backendRisk === "High" ||
    backendRisk === "Medium" ||
    backendRisk === "Low" ||
    backendRisk === "Normal"
  ) {
    return backendRisk;
  }

  if (a === -1 && s >= 0.65) return "High";
  if (s >= 0.85) return "High";
  if (s >= 0.65) return "Medium";
  if (s >= 0.4) return "Low";
  return "Normal";
}

function summarizeMessage(ev) {
  const t = ev.eventType || "";
  const user = ev.user || "Unknown";
  const client = ev.client || "Unknown";

  if (t.indexOf("UserAuthenticationSuccess") > -1) {
    return `User login success (${user})`;
  }

  if (t.indexOf("IdentityProviderAuthenticationSuccess") > -1) {
    return `Login via identity provider (${user})`;
  }

  if (t.indexOf("ClientAuthenticationSuccess") > -1) {
    return `Client authenticated (${client})`;
  }

  if (t.indexOf("TokenIssuedEvent") > -1) {
    return `Token issued for ${user} via ${client}`;
  }

  if (ev.message && ev.message.length > 80) {
    return ev.message.slice(0, 80) + "...";
  }

  return ev.message || "";
}

function deriveSecurityRow(ev) {
  let score =
    ev.anomalyScore !== undefined && ev.anomalyScore !== null
      ? Number(ev.anomalyScore)
      : 0;

  if (isNaN(score)) {
    score = 0;
  }

  const user = extractEmailDeep(ev);
  const client = extractClientDeep(ev);
  const origin = cleanOriginField(ev.origin);
  const eventGroup = mapTypeToGroup(ev.eventType || "");
  const backendRisk = ev.mlRisk || ev.risk || "";
  const risk = riskFromNormalizedScore(score, ev.anomaly, backendRisk);
  const riskState = normalizeValueState(ev.riskState || stateFromRisk(risk));

  return {
    time: formatTime(ev.time),
    originalTime: ev.time,
    user,
    client,
    origin,
    ip: ev.ip || "",
    eventType: ev.eventType || "",
    eventGroup,
    risk,
    riskState,
    anomalyScore: score,
    message: summarizeMessage({
      ...ev,
      user,
      client
    })
  };
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => new Date(b.originalTime || b.time) - new Date(a.originalTime || a.time));
}

function computeSecurityKpis(rows) {
  const kpi = {
    high: 0,
    medium: 0,
    low: 0,
    normal: 0,
    loginCount: 0,
    tokenCount: 0,
    clientCount: 0,
    otherCount: 0
  };

  rows.forEach((r) => {
    if (r.risk === "High") kpi.high++;
    else if (r.risk === "Medium") kpi.medium++;
    else if (r.risk === "Low") kpi.low++;
    else if (r.risk === "Normal") kpi.normal++;

    if (r.eventGroup === "LOGIN") kpi.loginCount++;
    else if (r.eventGroup === "TOKEN") kpi.tokenCount++;
    else if (r.eventGroup === "CLIENT") kpi.clientCount++;
    else kpi.otherCount++;
  });

  return kpi;
}

function computeTopUsers(rows) {
  const counts = {};

  rows.forEach((r) => {
    const u = r.user || "Unknown";
    counts[u] = (counts[u] || 0) + 1;
  });

  return Object.keys(counts)
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8);
}

function computeTopRiskyUsers(rows) {
  const agg = {};

  rows.forEach((r) => {
    const u = r.user || "Unknown";
    if (!agg[u]) {
      agg[u] = {
        name: u,
        high: 0,
        medium: 0,
        total: 0,
        scoreSum: 0
      };
    }

    agg[u].total += 1;
    agg[u].scoreSum += Number(r.anomalyScore || 0);

    if (r.risk === "High") agg[u].high += 1;
    if (r.risk === "Medium") agg[u].medium += 1;
  });

  return Object.keys(agg)
    .map((k) => ({
      name: agg[k].name,
      high: agg[k].high,
      medium: agg[k].medium,
      total: agg[k].total,
      avgScore: agg[k].total ? agg[k].scoreSum / agg[k].total : 0,
      risky: agg[k].high + agg[k].medium
    }))
    .filter((x) => x.risky > 0)
    .sort((a, b) => {
      if (b.risky !== a.risky) return b.risky - a.risky;
      return b.avgScore - a.avgScore;
    })
    .slice(0, 8);
}

function computeTopRiskyIps(rows) {
  const agg = {};

  rows.forEach((r) => {
    const ip = r.ip || "Unknown";
    if (!agg[ip]) {
      agg[ip] = {
        name: ip,
        high: 0,
        medium: 0,
        total: 0
      };
    }

    agg[ip].total += 1;
    if (r.risk === "High") agg[ip].high += 1;
    if (r.risk === "Medium") agg[ip].medium += 1;
  });

  return Object.keys(agg)
    .map((k) => ({
      name: agg[k].name,
      high: agg[k].high,
      medium: agg[k].medium,
      total: agg[k].total,
      risky: agg[k].high + agg[k].medium
    }))
    .filter((x) => x.name !== "Unknown" && x.risky > 0)
    .sort((a, b) => {
      if (b.risky !== a.risky) return b.risky - a.risky;
      return b.total - a.total;
    })
    .slice(0, 8);
}

function computeTopRiskyClients(rows) {
  const agg = {};

  rows.forEach((r) => {
    const client = r.client || "Unknown";
    if (!agg[client]) {
      agg[client] = {
        name: client,
        high: 0,
        medium: 0,
        total: 0
      };
    }

    agg[client].total += 1;
    if (r.risk === "High") agg[client].high += 1;
    if (r.risk === "Medium") agg[client].medium += 1;
  });

  return Object.keys(agg)
    .map((k) => ({
      name: agg[k].name,
      high: agg[k].high,
      medium: agg[k].medium,
      total: agg[k].total,
      risky: agg[k].high + agg[k].medium
    }))
    .filter((x) => x.name !== "Unknown" && x.risky > 0)
    .sort((a, b) => {
      if (b.risky !== a.risky) return b.risky - a.risky;
      return b.total - a.total;
    })
    .slice(0, 8);
}

function computeHourSummary(rows) {
  const hourCounts = {};
  for (let i = 0; i < 24; i++) {
    hourCounts[String(i).padStart(2, "0")] = 0;
  }

  rows.forEach((r) => {
    const d = new Date(r.originalTime || r.time);
    if (isNaN(d.getTime())) return;
    const hh = String(d.getHours()).padStart(2, "0");
    hourCounts[hh]++;
  });

  return Object.keys(hourCounts).map((h) => ({
    hour: h,
    count: hourCounts[h]
  }));
}

function computeAfterHoursInsight(rows) {
  let afterHours = 0;
  let afterHoursRisky = 0;

  rows.forEach((r) => {
    const d = new Date(r.originalTime || r.time);
    if (isNaN(d.getTime())) return;

    const hour = d.getHours();
    const isAfterHours = hour < 8 || hour >= 18;

    if (isAfterHours) {
      afterHours += 1;
      if (r.risk === "High" || r.risk === "Medium") {
        afterHoursRisky += 1;
      }
    }
  });

  return {
    afterHours,
    afterHoursRisky,
    afterHoursPct: rows.length ? (afterHours / rows.length) * 100 : 0
  };
}

function computeRiskDistribution(rows, kpis) {
  const total = rows.length || 1;

  return {
    highPct: ((kpis.high / total) * 100).toFixed(1),
    mediumPct: ((kpis.medium / total) * 100).toFixed(1),
    lowPct: ((kpis.low / total) * 100).toFixed(1),
    normalPct: ((kpis.normal / total) * 100).toFixed(1)
  };
}

function computeUniqueCounts(rows) {
  const users = new Set();
  const ips = new Set();
  const clients = new Set();

  rows.forEach((r) => {
    if (r.user && r.user !== "Unknown") users.add(r.user);
    if (r.ip && r.ip !== "Unknown") ips.add(r.ip);
    if (r.client && r.client !== "Unknown") clients.add(r.client);
  });

  return {
    users: users.size,
    ips: ips.size,
    clients: clients.size
  };
}

function truncateText(text, max = 40) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function stripUnknown(items) {
  return items.filter((x) => String(x.name || "").toLowerCase() !== "unknown");
}

function drawCard(doc, x, y, w, h, title, main, sub, color = "#0F172A") {
  doc.save();
  doc.roundedRect(x, y, w, h, 10).fillAndStroke("#F8FAFC", "#CBD5E1");
  doc.fillColor("#334155").font("Helvetica-Bold").fontSize(10).text(title, x + 12, y + 10, {
    width: w - 24
  });
  doc.fillColor(color).font("Helvetica-Bold").fontSize(20).text(String(main), x + 12, y + 32, {
    width: w - 24
  });
  if (sub) {
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(sub, x + 12, y + 58, {
      width: w - 24
    });
  }
  doc.restore();
}

function drawHorizontalBarChart(doc, items, startX, startY, chartWidth, barHeight, gap, colorPalette) {
  if (!items.length) {
    doc.fillColor("#64748B").font("Helvetica").fontSize(10).text("No data available.", startX, startY);
    return;
  }

  const maxVal = Math.max(...items.map((x) => x.count), 1);
  const labelWidth = 220;
  const valuePad = 40;

  items.forEach((item, i) => {
    const y = startY + i * (barHeight + gap);
    const label = truncateText(item.name, 34);
    const barW = Math.max(8, (item.count / maxVal) * chartWidth);

    doc.fillColor("#334155")
      .font("Helvetica")
      .fontSize(9)
      .text(label, startX, y + 2, {
        width: labelWidth
      });

    doc.fillColor(colorPalette[i % colorPalette.length])
      .rect(startX + labelWidth + 10, y, barW, barHeight)
      .fill();

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(String(item.count), startX + labelWidth + 10 + barW + 8, y + 2, {
        width: valuePad
      });
  });
}

function drawRiskyEntityBars(doc, items, startX, startY, chartWidth, barHeight, gap, color) {
  if (!items.length) {
    doc.fillColor("#64748B").font("Helvetica").fontSize(10).text("No risky concentration detected.", startX, startY);
    return;
  }

  const maxVal = Math.max(...items.map((x) => x.risky), 1);
  const labelWidth = 190;

  items.forEach((item, i) => {
    const y = startY + i * (barHeight + gap);
    const label = truncateText(item.name, 22);
    const barW = Math.max(8, (item.risky / maxVal) * chartWidth);

    doc.fillColor("#334155")
      .font("Helvetica")
      .fontSize(9)
      .text(label, startX, y + 2, {
        width: labelWidth
      });

    doc.fillColor(color)
      .rect(startX + labelWidth + 10, y, barW, barHeight)
      .fill();

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${item.risky}`, startX + labelWidth + 10 + barW + 8, y + 2, {
        width: 40
      });
  });
}

function drawRankedList(doc, title, items, x, y, w, rowHeight, formatter) {
  doc.fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(title, x, y);

  let cy = y + 24;

  if (!items.length) {
    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text("No data available.", x, cy);
    return cy + 20;
  }

  items.forEach((item, idx) => {
    if (idx % 2 === 0) {
      doc.save();
      doc.roundedRect(x, cy - 2, w, rowHeight, 6).fill("#F8FAFC");
      doc.restore();
    }

    const leftText = formatter.left(item, idx);
    const rightText = formatter.right(item, idx);

    doc.fillColor("#334155")
      .font("Helvetica")
      .fontSize(9)
      .text(leftText, x + 10, cy + 6, {
        width: w - 90
      });

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(rightText, x + w - 70, cy + 6, {
        width: 55,
        align: "right"
      });

    cy += rowHeight + 4;
  });

  return cy;
}

function drawSummaryBox(doc, title, lines, x, y, w, h) {
  doc.save();
  doc.roundedRect(x, y, w, h, 10).fillAndStroke("#F8FAFC", "#CBD5E1");
  doc.restore();

  doc.fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(title, x + 14, y + 12);

  let cy = y + 34;

  lines.forEach((line) => {
    doc.fillColor("#334155")
      .font("Helvetica")
      .fontSize(9.5)
      .text("• " + line, x + 16, cy, {
        width: w - 28
      });
    cy += 16;
  });
}

function drawHourBars(doc, items, startX, startY, chartWidth, chartHeight) {
  const maxVal = Math.max(...items.map((x) => x.count), 1);
  const barGap = 4;
  const barWidth = Math.floor((chartWidth - (items.length - 1) * barGap) / items.length);

  doc.save();
  doc.strokeColor("#CBD5E1").moveTo(startX, startY + chartHeight).lineTo(startX + chartWidth, startY + chartHeight).stroke();

  items.forEach((item, i) => {
    const h = maxVal ? (item.count / maxVal) * (chartHeight - 20) : 0;
    const x = startX + i * (barWidth + barGap);
    const y = startY + chartHeight - h;

    doc.fillColor("#38BDF8").rect(x, y, barWidth, h).fill();

    if (i % 2 === 0) {
      doc.fillColor("#475569").font("Helvetica").fontSize(7).text(item.hour, x - 2, startY + chartHeight + 4, {
        width: barWidth + 6,
        align: "center"
      });
    }
  });

  doc.restore();
}

// =====================================================
// EXCEL EXPORT
// =====================================================
router.get("/security/export", async (req, res) => {
  try {
    const { logs } = await loadSecurityLogs();
    const normalized = sortRows(logs.map(deriveSecurityRow));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Security Events");

    sheet.columns = [
      { header: "Time", key: "time", width: 20 },
      { header: "User", key: "user", width: 30 },
      { header: "Risk", key: "risk", width: 12 },
      { header: "Event Group", key: "eventGroup", width: 14 },
      { header: "Event Type", key: "eventType", width: 30 },
      { header: "IP", key: "ip", width: 15 },
      { header: "Client", key: "client", width: 30 },
      { header: "Origin", key: "origin", width: 22 },
      { header: "Message", key: "message", width: 40 },
      { header: "Score", key: "anomalyScore", width: 12 }
    ];

    normalized.forEach((l) => {
      sheet.addRow({
        time: l.time || "",
        user: l.user || "",
        risk: l.risk || "",
        eventGroup: l.eventGroup || "",
        eventType: l.eventType || "",
        ip: l.ip || "",
        client: l.client || "",
        origin: l.origin || "",
        message: l.message || "",
        anomalyScore:
          l.anomalyScore !== undefined && l.anomalyScore !== null && l.anomalyScore !== ""
            ? Number(l.anomalyScore).toFixed(3)
            : ""
      });
    });

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Security_Events.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[SECURITY EXCEL EXPORT] Failed:", err);
    res.status(500).send("Security Export Failed");
  }
});

// =====================================================
// PDF EXPORT - ENHANCED SUMMARY REPORT
// =====================================================
router.get("/security/export/pdf", async (req, res) => {
  try {
    const { logs, lastAuditDate } = await loadSecurityLogs();
    const normalized = sortRows(logs.map(deriveSecurityRow));
    const kpis = computeSecurityKpis(normalized);
    const topUsers = computeTopUsers(normalized);
    const topRiskyUsers = computeTopRiskyUsers(normalized);
    const topRiskyIps = computeTopRiskyIps(normalized);
    const topRiskyClients = computeTopRiskyClients(normalized);
    const hourSummary = computeHourSummary(normalized);
    const afterHours = computeAfterHoursInsight(normalized);
    const riskDist = computeRiskDistribution(normalized, kpis);
    const uniqueCounts = computeUniqueCounts(normalized);

    const busiestHour = hourSummary.slice().sort((a, b) => b.count - a.count)[0];
    const topUser = topUsers.length ? topUsers[0] : null;
    const topRiskyUser = topRiskyUsers.length ? topRiskyUsers[0] : null;
    const totalRisky = kpis.high + kpis.medium + kpis.low;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Security_Behaviour_Report.pdf"'
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 32
    });

    doc.pipe(res);

    // =========================
    // PAGE 1 - EXECUTIVE SUMMARY
    // =========================
    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("Security Behaviour Monitoring (UEBA) Report", 32, 24, {
        align: "center",
        width: 778
      });

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Generated on ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`,
        32,
        48,
        { align: "center", width: 778 }
      );

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        `Last Security Event Available: ${lastAuditDate || "N/A"}`,
        32,
        64,
        { align: "center", width: 778 }
      );

    const cardW = 170;
    const cardH = 88;
    const gapX = 18;
    const leftX = 32;
    const topY = 104;

    drawCard(doc, leftX, topY, cardW, cardH, "High Behaviour Risk", kpis.high, `${riskDist.highPct}% of all events`, "#DC2626");
    drawCard(doc, leftX + cardW + gapX, topY, cardW, cardH, "Medium Behaviour Risk", kpis.medium, `${riskDist.mediumPct}% of all events`, "#CA8A04");
    drawCard(doc, leftX + 2 * (cardW + gapX), topY, cardW, cardH, "Low Behaviour Risk", kpis.low, `${riskDist.lowPct}% of all events`, "#0891B2");
    drawCard(doc, leftX + 3 * (cardW + gapX), topY, cardW, cardH, "Total Events", normalized.length, `${uniqueCounts.users} users / ${uniqueCounts.ips} IPs`, "#475569");

    const miniY = topY + cardH + 28;

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Event Group Summary", 32, miniY);

    doc.font("Helvetica-Bold").fontSize(11);
    doc.fillColor("#DC2626").text(`LOGIN: ${kpis.loginCount}`, 32, miniY + 22);
    doc.fillColor("#CA8A04").text(`TOKEN: ${kpis.tokenCount}`, 150, miniY + 22);
    doc.fillColor("#0891B2").text(`CLIENT: ${kpis.clientCount}`, 270, miniY + 22);
    doc.fillColor("#475569").text(`OTHER: ${kpis.otherCount}`, 395, miniY + 22);

    const findingsY = miniY + 62;
    const findings = [
      `The monitored security stream contains ${normalized.length} events, of which ${totalRisky} are classified above normal risk.`,
      `High-risk events account for ${riskDist.highPct}% of the observed dataset, while medium-risk events account for ${riskDist.mediumPct}%.`,
      topUser
        ? `The most active user is "${topUser.name}" with ${topUser.count} recorded events.`
        : "No dominant user activity could be determined.",
      topRiskyUser
        ? `The riskiest user concentration is "${topRiskyUser.name}" with ${topRiskyUser.risky} high/medium events and an average anomaly score of ${topRiskyUser.avgScore.toFixed(3)}.`
        : "No risky user concentration could be determined.",
      busiestHour
        ? `The busiest hour of the day is ${busiestHour.hour}:00 with ${busiestHour.count} events.`
        : "No hourly activity pattern could be determined.",
      `After-hours activity represents ${afterHours.afterHoursPct.toFixed(1)}% of total events, with ${afterHours.afterHoursRisky} risky events occurring outside normal business hours.`
    ];

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Executive Findings", 32, findingsY);

    let fy = findingsY + 22;
    findings.forEach((line) => {
      doc.fillColor("#334155")
        .font("Helvetica")
        .fontSize(10)
        .text("• " + line, 40, fy, { width: 730 });
      fy += 18;
    });

    // =========================
    // PAGE 2 - USER EXPOSURE
    // =========================
    doc.addPage();

    const activeUsersClean = stripUnknown(topUsers).slice(0, 6);
    const riskyUsersClean = topRiskyUsers.slice(0, 6);

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Risk Distribution and User Exposure", 32, 28);

    drawCard(doc, 32, 70, 180, 80, "High Risk", kpis.high, `${riskDist.highPct}% of total`, "#DC2626");
    drawCard(doc, 230, 70, 180, 80, "Medium Risk", kpis.medium, `${riskDist.mediumPct}% of total`, "#CA8A04");
    drawCard(doc, 428, 70, 180, 80, "Low Risk", kpis.low, `${riskDist.lowPct}% of total`, "#0891B2");
    drawCard(doc, 626, 70, 180, 80, "Normal", kpis.normal, `${riskDist.normalPct}% of total`, "#16A34A");

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Most Active Known Users", 32, 178);

    drawHorizontalBarChart(
      doc,
      activeUsersClean.map((x) => ({ name: x.name, count: x.count })),
      40,
      205,
      220,
      18,
      10,
      ["#DC2626", "#F59E0B", "#06B6D4", "#64748B", "#8B5CF6", "#10B981"]
    );

    drawRankedList(
  doc,
  "Users with Highest Risk Concentration",
  riskyUsersClean,
  490,
  178,
  280,
  24,
  {
    left: function (item, idx) {
      return (idx + 1) + ". " + truncateText(item.name, 26);
    },
    right: function (item) {
      return item.risky + " risky";
    }
  }
);

    drawSummaryBox(
      doc,
      "User Exposure Summary",
      [
        topUser
          ? `The most active known user is "${truncateText(topUser.name, 30)}" with ${topUser.count} total events.`
          : "No dominant known user could be identified.",
        topRiskyUser
          ? `"${truncateText(topRiskyUser.name, 30)}" shows the highest risky concentration with ${topRiskyUser.risky} high/medium events.`
          : "No user with significant risky concentration was detected.",
        `Unknown or unattributed activity should be reviewed separately because it can hide real user ownership.`
      ],
      32,
      410,
      738,
      92
    );

    // =========================
    // PAGE 3 - ACCESS EXPOSURE
    // =========================
    doc.addPage();

    const riskyIpsClean = topRiskyIps.slice(0, 6);
    const riskyClientsClean = topRiskyClients.slice(0, 6);
    const topRiskyIp = riskyIpsClean.length ? riskyIpsClean[0] : null;
    const topRiskyClient = riskyClientsClean.length ? riskyClientsClean[0] : null;

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Attack Surface and Access Exposure", 32, 28);

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Top Risky IP Addresses", 32, 70);

    drawRiskyEntityBars(
      doc,
      riskyIpsClean,
      40,
      95,
      180,
      18,
      10,
      "#F97316"
    );

    drawRankedList(
  doc,
  "Top Risky Client Applications",
  riskyClientsClean,
  490,
  70,
  280,
  24,
  {
    left: function (item, idx) {
      return (idx + 1) + ". " + truncateText(item.name, 26);
    },
    right: function (item) {
      return item.risky + " risky";
    }
  }
);

    drawCard(doc, 32, 330, 220, 82, "After-Hours Events", afterHours.afterHours, "Events before 08:00 or after 18:00", "#7C3AED");
    drawCard(doc, 270, 330, 220, 82, "After-Hours Risky Events", afterHours.afterHoursRisky, "High/Medium events outside business hours", "#DC2626");
    drawCard(doc, 508, 330, 220, 82, "Unique Clients", uniqueCounts.clients, "Distinct client applications observed", "#475569");

    drawSummaryBox(
      doc,
      "Access Exposure Summary",
      [
        topRiskyIp
          ? `The riskiest IP observed is ${topRiskyIp.name} with ${topRiskyIp.risky} high/medium events.`
          : "No risky IP concentration was identified.",
        topRiskyClient
          ? `The client application with the highest risk concentration is "${truncateText(topRiskyClient.name, 34)}" with ${topRiskyClient.risky} risky events.`
          : "No risky client application concentration was identified.",
        `After-hours activity accounts for ${afterHours.afterHoursPct.toFixed(1)}% of all events and should be reviewed against expected business patterns.`
      ],
      32,
      430,
      738,
      92
    );

    // =========================
    // PAGE 4 - HOURLY ACTIVITY
    // =========================
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("IAM Activity by Hour of Day", 32, 28);

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        "This chart summarizes how security-related activity is distributed across the day.",
        32,
        50,
        { width: 760 }
      );

    drawHourBars(doc, hourSummary, 45, 110, 700, 250);

    // =========================
    // PAGE 5 - RECENT HIGH/MEDIUM EVENTS
    // =========================
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Recent High and Medium Risk Events", 32, 28);

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text("Latest 12 events requiring analyst attention.", 32, 50);

    const recentRisky = normalized
      .filter((x) => x.risk === "High" || x.risk === "Medium")
      .slice(0, 12);

    const columns = {
      time: 32,
      user: 140,
      risk: 320,
      group: 385,
      type: 455,
      ip: 655
    };

    let y = 88;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    doc.text("Time", columns.time, y);
    doc.text("User", columns.user, y);
    doc.text("Risk", columns.risk, y);
    doc.text("Group", columns.group, y);
    doc.text("Event Type", columns.type, y);
    doc.text("IP", columns.ip, y);

    y += 14;
    doc.moveTo(32, y).lineTo(790, y).strokeColor("#CBD5E1").stroke();
    y += 8;

    recentRisky.forEach((l, idx) => {
      if (idx % 2 === 0) {
        doc.save();
        doc.rect(32, y - 2, 758, 22).fill("#F8FAFC");
        doc.restore();
      }

      doc.fillColor("#334155").font("Helvetica").fontSize(8.5);
      doc.text(truncateText(l.time || "", 22), columns.time, y, { width: 100 });
      doc.text(truncateText(l.user || "", 26), columns.user, y, { width: 170 });
      doc.text(truncateText(l.risk || "", 10), columns.risk, y, { width: 50 });
      doc.text(truncateText(l.eventGroup || "", 12), columns.group, y, { width: 55 });
      doc.text(truncateText(l.eventType || "", 26), columns.type, y, { width: 185 });
      doc.text(truncateText(l.ip || "", 18), columns.ip, y, { width: 110 });

      y += 24;
    });

    // =========================
    // PAGE 6 - FINAL CONCLUSION
    // =========================
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text("Final Security Assessment", 32, 28);

    const finalLines = [
      `A total of ${normalized.length} security events were analyzed across ${uniqueCounts.users} unique users, ${uniqueCounts.ips} unique IP addresses, and ${uniqueCounts.clients} client applications.`,
      `${totalRisky} events were classified above normal risk, including ${kpis.high} high-risk and ${kpis.medium} medium-risk events.`,
      topRiskyUser
        ? `User behaviour risk is concentrated most strongly around "${truncateText(topRiskyUser.name, 34)}".`
        : `No single user dominates risky behaviour patterns.`,
      topRiskyIp
        ? `Network exposure is most visible from IP ${topRiskyIp.name}, which should be reviewed for source legitimacy and recurrence.`
        : `No major IP concentration was detected.`,
      topRiskyClient
        ? `Client-side exposure is led by "${truncateText(topRiskyClient.name, 36)}", which may require token and authentication review.`
        : `No major client concentration was detected.`,
      `After-hours activity is meaningful and may indicate either legitimate batch/service behaviour or non-standard access patterns requiring validation.`,
      `Recommended next step: prioritize investigation of recent high/medium risk events, then validate top risky users, IPs, and client applications against expected operational behaviour.`
    ];

    drawSummaryBox(
      doc,
      "Conclusion",
      finalLines,
      32,
      80,
      738,
      190
    );

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Recommended Analyst Focus", 32, 300);

    const focusItems = [
      `1. Review the most recent high and medium risk events first.`,
      `2. Validate whether top risky users are expected actors for the observed activities.`,
      `3. Check whether top risky IP addresses belong to trusted corporate or known service ranges.`,
      `4. Confirm whether top risky client applications are expected to generate this volume and timing of events.`,
      `5. Investigate unknown or unattributed identities to reduce blind spots in monitoring.`
    ];

    let focusY = 326;
    focusItems.forEach((line) => {
      doc.fillColor("#334155")
        .font("Helvetica")
        .fontSize(10)
        .text(line, 40, focusY, { width: 720 });
      focusY += 20;
    });

    doc.end();
  } catch (err) {
    console.error("[SECURITY PDF EXPORT] Failed:", err);
    res.status(500).send("Security PDF export failed");
  }
});

export default router;