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
async function loadUiLogs() {
  const { data } = await axios.get(`${API_BASE}/audit/full`);
  const logs = Array.isArray(data.logs) ? data.logs : [];
  return logs;
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

function safeParseMessage(row) {
  try {
    if (row && row.raw && row.raw.message) {
      return JSON.parse(row.raw.message);
    }
  } catch (e) {
    // ignore malformed payloads
  }
  return null;
}

function getActor(row) {
  return (
    (row && row.actor) ||
    (row && row.raw && row.raw.user) ||
    "Unknown"
  );
}

function cleanActorDisplay(value) {
  if (!value) {
    return "Unknown";
  }

  const s = String(value).trim();

  // 1) if there is an email anywhere, show only the email
  const match = s.match(EMAIL_RE);
  if (match) {
    return match[0].toLowerCase();
  }

  // 2) if it starts with user/, keep only the last segment
  if (s.indexOf("user/") === 0) {
    const parts = s.split("/");
    return parts[parts.length - 1] || s;
  }

  // 3) keep technical actors as-is
  return s;
}

function cleanTargetDisplay(value) {
  if (!value) {
    return "Unknown";
  }

  const s = String(value).trim();

  if (s === "Unknown") {
    return "Unknown";
  }

  const match = s.match(EMAIL_RE);
  if (match) {
    return match[0].toLowerCase();
  }

  if (s.indexOf("user/") === 0) {
    const parts = s.split("/");
    return parts[parts.length - 1] || s;
  }

  return s;
}

function isHumanEvent(row) {
  const actor = getActor(row);

  return (
    !!(row && row.isHuman === true) ||
    (typeof actor === "string" && actor.indexOf("user/") === 0) ||
    (typeof actor === "string" && actor.indexOf("@") > -1)
  );
}

function normalizeCrud(value, fallback) {
  let v = (value || fallback || "OTHER");
  v = String(v).trim().toUpperCase();

  if (v === "CREATE" || v === "UPDATE" || v === "DELETE") {
    return v;
  }

  return "OTHER";
}

function extractCrudType(row, parsed) {
  let crud = "";
  const attrs = parsed && parsed.attributes ? parsed.attributes : [];
  let i;

  // 1) best source: object.id.crudType
  crud =
    parsed &&
    parsed.object &&
    parsed.object.id &&
    parsed.object.id.crudType;

  if (crud) {
    return normalizeCrud(crud, row && row.action);
  }

  // 2) operationType
  crud =
    parsed &&
    parsed.object &&
    parsed.object.id &&
    parsed.object.id.operationType;

  if (crud) {
    return normalizeCrud(crud, row && row.action);
  }

  // 3) sometimes operation appears in attributes
  for (i = 0; i < attrs.length; i++) {
    if (attrs[i] && attrs[i].name === "operation") {
      crud = attrs[i].new || attrs[i].old;
      if (crud) {
        return normalizeCrud(crud, row && row.action);
      }
    }
  }

  // 4) generic fallback
  crud = parsed && parsed.crudType;
  if (crud) {
    return normalizeCrud(crud, row && row.action);
  }

  return normalizeCrud(row && row.action, "OTHER");
}

function extractRoleName(row) {
  if (!row) {
    return "";
  }

  // 1) Best source: rolecollection_name from raw audit payload
  try {
    const parsed = JSON.parse((row.raw && row.raw.message) || "{}");
    const role =
      parsed &&
      parsed.object &&
      parsed.object.id &&
      parsed.object.id.rolecollection_name;

    if (role) {
      return String(role).trim();
    }
  } catch (e) {
    // ignore
  }

  // 2) Fallback: details column
  if (row.details) {
    const d = String(row.details).trim();

    if (d.indexOf("Assigned role: ") === 0) {
      return d.replace("Assigned role: ", "").trim();
    }

    const denyList = [
      "User identity updated",
      "Technical configuration",
      "Technical event",
      "Role collection assigned or removed",
      "Configuration Change",
      "Redeployment",
      "Deployment",
      "Update",
      "Updated",
      "Unknown"
    ];

    if (d && denyList.indexOf(d) === -1) {
      return d;
    }
  }

  // 3) Fallback: target if meaningful
  if (
    row.target &&
    row.target !== "Unknown" &&
    row.target !== row.actor
  ) {
    return String(row.target).trim();
  }

  return "";
}

function isRoleAssignmentRow(row) {
  return !!extractRoleName(row);
}

function deriveDisplayRow(row) {
  const parsed = safeParseMessage(row);

  const actorRaw = getActor(row);
  const actor = cleanActorDisplay(actorRaw);

  const action = extractCrudType(row, parsed);
  let target = (row && row.target) || "Unknown";
  let objectType = (row && row.objectType) || "Configuration Change";
  let details = (row && row.details) || "";

  const objType = parsed && parsed.object && parsed.object.type;
  const objId = parsed && parsed.object && parsed.object.id ? parsed.object.id : {};
  const roleName = objId.rolecollection_name || "";

  let human = isHumanEvent(row);

  if (isRoleAssignmentRow(row)) {
    objectType = "Role Assignment";
    target = cleanTargetDisplay(roleName || extractRoleName(row) || target || "Role");
    details = extractRoleName(row)
      ? ("Assigned role: " + extractRoleName(row))
      : "Role assignment";
    human = true;
  } else if (objType === "scim user") {
    objectType = "User Profile Update";
    target = target && target !== "Unknown"
      ? cleanTargetDisplay(target)
      : actor;
    details = details || "User identity updated";
    human = true;
  } else {
    objectType = objectType || "Configuration Change";
    details = details || "";
    target = cleanTargetDisplay(target);
  }

  return {
    uuid: row.uuid,
    time: formatTime(row.time),
    actor: actor || "Unknown",
    target: target || "Unknown",
    objectType: objectType || "Configuration Change",
    action: action || "OTHER",
    details: details || "",
    isHuman: !!human,
    raw: row.raw || null,
    risk: row.risk || "",
    riskState: row.riskState || "",
    anomalyScore:
      row.anomalyScore !== undefined && row.anomalyScore !== null
        ? row.anomalyScore
        : ""
  };
}

function computeLogKpis(rows) {
  const humanRows = rows.filter((r) => isHumanEvent(r));

  const roleRows = humanRows.filter((r) => {
    try {
      const parsed = JSON.parse((r.raw && r.raw.message) || "{}");
      const tableName =
        parsed &&
        parsed.object &&
        parsed.object.id &&
        parsed.object.id.tableName;

      const objectType =
        parsed &&
        parsed.object &&
        parsed.object.type;

      if (
        tableName === "xs_rolecollection2user" ||
        objectType === "xs_rolecollection2user"
      ) {
        return true;
      }
    } catch (e) {
      // ignore
    }

    return !!extractRoleName(r);
  });

  const roleCounts = {};
  const actorCounts = {};
  const crudSummary = {
    CREATE: 0,
    UPDATE: 0,
    DELETE: 0,
    OTHER: 0
  };

  humanRows.forEach((r) => {
    const parsed = safeParseMessage(r);
    const crud = extractCrudType(r, parsed);

    if (crudSummary[crud] !== undefined) {
      crudSummary[crud] += 1;
    } else {
      crudSummary.OTHER += 1;
    }
  });

  roleRows.forEach((r) => {
    const role = extractRoleName(r);
    const actor = cleanActorDisplay(r.actor || "Unknown");

    if (!role) {
      return;
    }

    roleCounts[role] = (roleCounts[role] || 0) + 1;
    actorCounts[actor] = (actorCounts[actor] || 0) + 1;
  });

  const sortedRoles = Object.keys(roleCounts)
    .map((key) => ({ name: key, count: roleCounts[key] }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name);
    });

  const sortedActors = Object.keys(actorCounts)
    .map((key) => ({ name: key, count: actorCounts[key] }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.name.localeCompare(b.name);
    });

  const topRole = sortedRoles.length ? sortedRoles[0] : null;
  const topActor = sortedActors.length ? sortedActors[0] : null;

  return {
    totalHumanChanges: humanRows.length,
    totalRoleAssignments: roleRows.length,
    topAssignedRole: topRole ? topRole.name : "N/A",
    topAssignedRoleCount: topRole ? topRole.count : 0,
    topGrantingActor: topActor ? topActor.name : "N/A",
    topGrantingActorCount: topActor ? topActor.count : 0,
    top10Roles: sortedRoles.slice(0, 10),
    crudSummary
  };
}

function truncateText(text, max = 40) {
  const t = String(text || "");
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function sortRows(rows) {
  return rows.slice().sort((a, b) => new Date(b.time) - new Date(a.time));
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

function drawHorizontalBarChart(doc, top10Roles, startX, startY, chartWidth, barHeight, gap) {
  if (!top10Roles.length) {
    doc.fillColor("#64748B").font("Helvetica").fontSize(10).text("No role assignment data available.", startX, startY);
    return;
  }

  const maxVal = Math.max(...top10Roles.map((x) => x.count), 1);

  const palette = [
    "#2F6497",
    "#3A7CA5",
    "#4C8CBF",
    "#5BA2C7",
    "#6D9FA3",
    "#7F9192",
    "#8FA1B3",
    "#A3B6C2",
    "#C8D4DC",
    "#E3E8EC"
  ];

  top10Roles.forEach((role, i) => {
    const y = startY + i * (barHeight + gap);
    const label = truncateText(role.name, 46);
    const barW = Math.max(8, (role.count / maxVal) * chartWidth);

    doc.fillColor("#334155").font("Helvetica").fontSize(9).text(label, startX, y + 2, {
      width: 230
    });

    doc.fillColor(palette[i % palette.length])
      .rect(startX + 240, y, barW, barHeight)
      .fill();

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(String(role.count), startX + 245 + barW, y + 2);
  });
}

// =====================================================
// EXCEL EXPORT
// =====================================================
router.get("/audit/export/excel", async (req, res) => {
  try {
    const logs = sortRows((await loadUiLogs()).map(deriveDisplayRow));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Configuration Audit Logs");

    sheet.columns = [
      { header: "Time", key: "time", width: 22 },
      { header: "Type", key: "objectType", width: 24 },
      { header: "Action", key: "action", width: 12 },
      { header: "Details", key: "details", width: 50 },
      { header: "Actor", key: "actor", width: 30 },
      { header: "Target", key: "target", width: 28 },
      { header: "Risk", key: "risk", width: 12 },
      { header: "Risk State", key: "riskState", width: 14 },
      { header: "Anomaly Score", key: "anomalyScore", width: 18 }
    ];

    logs.forEach((l) => {
      sheet.addRow({
        time: l.time || "",
        objectType: l.objectType || "",
        action: l.action || "",
        details: l.details || "",
        actor: l.actor || "",
        target: l.target || "",
        risk: l.risk || "",
        riskState: l.riskState || "",
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
      'attachment; filename="Configuration_Audit_Logs.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[LOGS EXCEL EXPORT] Failed:", err);
    res.status(500).send("Excel export failed");
  }
});

// =====================================================
// PDF EXPORT
// =====================================================
router.get("/audit/export/pdf", async (req, res) => {
  try {
    const normalizedLogs = sortRows((await loadUiLogs()).map(deriveDisplayRow));
    const kpis = computeLogKpis(normalizedLogs);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="Configuration_Audit_Report.pdf"'
    );

    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 32
    });

    doc.pipe(res);

    // PAGE 1
    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("Configuration Audit Summary Report", 32, 24, {
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

    const cardW = 360;
    const cardH = 88;
    const gapX = 18;
    const gapY = 18;
    const leftX = 32;
    const topY = 92;

    drawCard(
      doc,
      leftX,
      topY,
      cardW,
      cardH,
      "Total Human Changes",
      kpis.totalHumanChanges,
      "Human-attributed configuration activity"
    );

    drawCard(
      doc,
      leftX + cardW + gapX,
      topY,
      cardW,
      cardH,
      "Total Role Assignments",
      kpis.totalRoleAssignments,
      "Role collection assignments observed"
    );

    drawCard(
      doc,
      leftX,
      topY + cardH + gapY,
      cardW,
      cardH,
      "Top Assigned Role",
      truncateText(kpis.topAssignedRole, 28),
      `Occurrences in logs: ${kpis.topAssignedRoleCount}`,
      "#1D4ED8"
    );

    drawCard(
      doc,
      leftX + cardW + gapX,
      topY + cardH + gapY,
      cardW,
      cardH,
      "Top Granting Actor",
      truncateText(kpis.topGrantingActor, 30),
      `Logged actions: ${kpis.topGrantingActorCount}`,
      "#15803D"
    );

    const crudY = topY + (2 * cardH) + gapY + 28;

    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("CRUD Summary", 32, crudY);

    doc.font("Helvetica-Bold").fontSize(11);

    doc.fillColor("#15803D")
      .text(`CREATE: ${kpis.crudSummary.CREATE}`, 32, crudY + 22);

    doc.fillColor("#B45309")
      .text(`UPDATE: ${kpis.crudSummary.UPDATE}`, 140, crudY + 22);

    doc.fillColor("#DC2626")
      .text(`DELETE: ${kpis.crudSummary.DELETE}`, 250, crudY + 22);

    doc.fillColor("#2563EB")
      .text(`OTHER: ${kpis.crudSummary.OTHER}`, 340, crudY + 22);

    const findingsY = crudY + 60;
    doc.fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Key Findings", 32, findingsY);

    const createPct = kpis.totalHumanChanges
      ? ((kpis.crudSummary.CREATE / kpis.totalHumanChanges) * 100).toFixed(1)
      : "0.0";

    const updatePct = kpis.totalHumanChanges
      ? ((kpis.crudSummary.UPDATE / kpis.totalHumanChanges) * 100).toFixed(1)
      : "0.0";

    const findings = [
      `The audit stream contains ${kpis.totalHumanChanges} human-attributed configuration changes.`,
      `Role assignment activity accounts for ${kpis.totalRoleAssignments} observed events.`,
      `The most frequently assigned role collection is "${kpis.topAssignedRole}" with ${kpis.topAssignedRoleCount} logged occurrences.`,
      `The actor with the highest observed granting activity is "${kpis.topGrantingActor}" with ${kpis.topGrantingActorCount} logged actions.`,
      `CRUD distribution indicates CREATE at ${createPct}% and UPDATE at ${updatePct}% of human changes.`
    ];

    let fy = findingsY + 22;
    findings.forEach((line) => {
      doc.fillColor("#334155")
        .font("Helvetica")
        .fontSize(10)
        .text("• " + line, 40, fy, { width: 730 });
      fy += 18;
    });

    // PAGE 2
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Top Assigned Role Collections", 32, 28);

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text(
        "This chart highlights the most frequently assigned role collections detected in the audit logs.",
        32,
        50,
        { width: 760 }
      );

    drawHorizontalBarChart(doc, kpis.top10Roles, 40, 95, 470, 20, 12);

    // PAGE 3
    doc.addPage();

    doc.fillColor("#0F172A")
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("Recent Audit Events", 32, 28);

    doc.fillColor("#64748B")
      .font("Helvetica")
      .fontSize(10)
      .text("Latest 12 events for quick review.", 32, 50);

    const recent = normalizedLogs.slice(0, 12);

    const columns = {
      time: 32,
      action: 175,
      type: 245,
      actor: 395,
      target: 585
    };

    let y = 88;

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827");
    doc.text("Time", columns.time, y);
    doc.text("Action", columns.action, y);
    doc.text("Type", columns.type, y);
    doc.text("Actor", columns.actor, y);
    doc.text("Target", columns.target, y);

    y += 14;
    doc.moveTo(32, y).lineTo(790, y).strokeColor("#CBD5E1").stroke();
    y += 8;

    recent.forEach((l, idx) => {
      if (idx % 2 === 0) {
        doc.save();
        doc.rect(32, y - 2, 758, 22).fill("#F8FAFC");
        doc.restore();
      }

      doc.fillColor("#334155").font("Helvetica").fontSize(8.5);
      doc.text(truncateText(l.time || "", 22), columns.time, y, { width: 130 });
      doc.text(truncateText(l.action || "", 10), columns.action, y, { width: 55 });
      doc.text(truncateText(l.objectType || "", 22), columns.type, y, { width: 135 });
      doc.text(truncateText(l.actor || "", 28), columns.actor, y, { width: 180 });
      doc.text(truncateText(l.target || "", 28), columns.target, y, { width: 180 });

      y += 24;
    });

    doc.end();
  } catch (err) {
    console.error("[LOGS PDF EXPORT] Failed:", err);
    res.status(500).send("PDF export failed");
  }
});

export default router;
