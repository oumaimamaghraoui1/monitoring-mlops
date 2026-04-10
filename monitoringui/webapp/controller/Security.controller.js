sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  // ============================================
  // Utility formatting
  // ============================================

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return (
      d.getFullYear() + "-" +
      pad(d.getMonth() + 1) + "-" +
      pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" +
      pad(d.getMinutes()) + ":" +
      pad(d.getSeconds())
    );
  }

  function includesIC(hay, needle) {
    if (!needle) return true;
    if (!hay) return false;
    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  function mapTypeToGroup(t) {
    if (!t) return "OTHER";
    if (t.includes("UserAuthenticationSuccess")) return "LOGIN";
    if (t.includes("IdentityProviderAuthenticationSuccess")) return "LOGIN";
    if (t.includes("TokenIssuedEvent")) return "TOKEN";
    if (t.includes("ClientAuthenticationSuccess")) return "CLIENT";
    return "OTHER";
  }

  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  // ============================================
  // Deep extraction helpers
  // These repair older nested rows without touching the file
  // ============================================

  function collectNestedStrings(obj, out = []) {
    if (!obj) return out;

    if (typeof obj === "string") {
      out.push(obj);
      return out;
    }

    if (Array.isArray(obj)) {
      obj.forEach(x => collectNestedStrings(x, out));
      return out;
    }

    if (typeof obj === "object") {
      Object.keys(obj).forEach(k => collectNestedStrings(obj[k], out));
      return out;
    }

    return out;
  }

  function extractEmailDeep(ev) {
    // 1) top-level user if already email
    if (ev.user && EMAIL_RE.test(String(ev.user))) {
      const m = String(ev.user).match(EMAIL_RE);
      if (m) return m[0];
    }

    // 2) search in nested raw/message strings
    const strings = collectNestedStrings(ev);
    for (const s of strings) {
      const m = String(s).match(EMAIL_RE);
      if (m) return m[0];
    }

    return "Unknown";
  }

  function normalizeClient(client) {
    if (!client) return "Unknown";

    const c = String(client).replace(/\"/g, "").trim();

    // Keep technical ids readable instead of reducing to only "it"
    if (c.includes("sb-") || c.includes("|")) {
      const label = c.split("|")[1]?.split("!")[0] || c;
      return `${label} (${c})`;
    }

    return c;
  }

  function extractClientDeep(ev) {
    // 1) prefer top-level client if already useful
    if (ev.client && ev.client !== "Unknown") {
      return normalizeClient(ev.client);
    }

    const strings = collectNestedStrings(ev);

    for (const s of strings) {
      const str = String(s);

      // JSON-style client identifiers
      let m =
        /"client_id"\s*:\s*"([^"]+)"/.exec(str) ||
        /"cid"\s*:\s*"([^"]+)"/.exec(str) ||
        /"azp"\s*:\s*"([^"]+)"/.exec(str) ||
        /clientId=([^,\]]+)/.exec(str);

      if (m && m[1]) {
        return normalizeClient(m[1]);
      }

      // Direct service principal fallback
      if (str.includes("sb-") && (str.includes("|") || str.includes("!"))) {
        return normalizeClient(str);
      }
    }

    return "Unknown";
  }

  function cleanOriginField(origin) {
    if (!origin) return "N/A";
    return String(origin);
  }

  function summarizeMessage(ev) {
    const t = ev.eventType || "";
    const user = ev.user || "Unknown";
    const client = ev.client || "Unknown";

    if (t.includes("UserAuthenticationSuccess")) {
      return `User login success (${user})`;
    }

    if (t.includes("IdentityProviderAuthenticationSuccess")) {
      return `Login via identity provider (${user})`;
    }

    if (t.includes("ClientAuthenticationSuccess")) {
      return `Client authenticated (${client})`;
    }

    if (t.includes("TokenIssuedEvent")) {
      return `Token issued for ${user} via ${client}`;
    }

    if (ev.message && ev.message.length > 80) {
      return ev.message.slice(0, 80) + "...";
    }

    return ev.message || "";
  }

  // ============================================
  // Main controller
  // ============================================

  return Controller.extend("pwc.monitoring.monitoringui.controller.Security", {

    onInit() {
      const model = new JSONModel({
        all: [],
        rows: [],
        typeKey: "ALL",
        emailFilter: "",
        ipFilter: "",
        kpi: {
          high: 0,
          medium: 0,
          low: 0
        }
      });

      this.getView().setModel(model, "security");
      this.onRefresh();
    },

    // ============================================
    // Load merged + scored security events
    // Backend /security/events must already return:
    // { logs: [ ...with anomalyScore... ] }
    // ============================================
    onRefresh() {
      const API_BASE =
        "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

      fetch(`${API_BASE}/security/events`, {
        credentials: "include"
      })
        .then(async (r) => {
          if (!r.ok) {
            const text = await r.text();
            throw new Error(
              `HTTP ${r.status} ${r.statusText}: ${text.slice(0, 200)}`
            );
          }
          return r.json();
        })
        .then((json) => {
          const arr = Array.isArray(json.logs) ? json.logs : [];

          const norm = arr.map((ev) => {
            const score = ev.anomalyScore ?? 0;

            const risk =
              score < -0.4 ? "High" :
              score < -0.2 ? "Medium" :
              score < 0 ? "Low" :
              "Normal";

            const riskState =
              risk === "High" ? "Error" :
              risk === "Medium" ? "Critical" :
              risk === "Low" ? "Warning" :
              "Success";

            const user = extractEmailDeep(ev);
            const client = extractClientDeep(ev);
            const origin = cleanOriginField(ev.origin);
            const msg = summarizeMessage({
              ...ev,
              user,
              client
            });

            return {
              ...ev,
              user,
              client,
              origin,
              message: msg,
              time: formatTime(ev.time),
              eventGroup: mapTypeToGroup(ev.eventType || ""),
              anomalyScore: score,
              risk,
              riskState
            };
          });

          norm.sort((a, b) => new Date(b.time) - new Date(a.time));

          const m = this.getView().getModel("security");
          m.setProperty("/all", norm);
          m.setProperty("/lastAuditDate",json.lastAuditDate);
          // =============================
// Events per hour timeline
// =============================
// ===============================
// IAM Activity by Hour of Day
// ===============================
const hourCounts = {};

// initialize 24h
for(let i=0;i<24;i++){
  const label = (`0${i}`).slice(-2);
  hourCounts[label] = 0;
}

// count events per hour
norm.forEach(ev=>{
  if(!ev.time) return;

  const hour =
      new Date(ev.time)
      .getHours();

  const label =
      (`0${hour}`).slice(-2);

  hourCounts[label]++;
});

// convert to chart dataset
const hourChart =
  Object.entries(hourCounts)
  .map(([hour,count])=>({
    time:hour,
    count
  }));

m.setProperty("/hourChart",hourChart);



          // ==============================
// Aggregate events per user
// For Pie / Donut chart
// ==============================

const userCounts = {};

norm.forEach(ev => {
  const u = ev.user || "Unknown";

  if (!userCounts[u]) {
    userCounts[u] = 0;
  }
  userCounts[u]++;
});

// Turn into array for SAP chart binding
const chartUsers = Object.entries(userCounts)
  .map(([user,count]) => ({
    user,
    count
  }))
  .sort((a,b)=>b.count-a.count)
  .slice(0,8); // top 8 users (avoid clutter)

m.setProperty("/userChart", chartUsers);

          // KPI from full dataset
          m.setProperty("/kpi", {
            high: norm.filter(x => x.risk === "High").length,
            medium: norm.filter(x => x.risk === "Medium").length,
            low: norm.filter(x => x.risk === "Low").length
          });

          this._applyFilters();
        })
        .catch((err) => {
          console.error("[SEC] Load failed", err);

          const m = this.getView().getModel("security");
          m.setProperty("/all", []);
          m.setProperty("/rows", []);
          m.setProperty("/kpi", {
            high: 0,
            medium: 0,
            low: 0
          });
        });
    },
onUserPieSelect(oEvent){

  const data =
    oEvent.getParameter("data")[0].data;

  const user  = data.User;
  const count = data.Events;

  sap.m.MessageBox.information(
    `${user}\n\nGenerated ${count} IAM Security Events`,
    {title:"User Event Count"}
  );

},
    onBack() {
      this.getOwnerComponent().getRouter().navTo("logs", {}, false);
    },

    onGoDataChanges() {
      this.getOwnerComponent().getRouter().navTo("datachanges", {}, false);
    },

    onGoLogs() {
      this.getOwnerComponent().getRouter().navTo("logs", {}, false);
    },

    // ============================================
    // Filter handlers
    // ============================================

    onTypeChange(oEvent) {
      const key = oEvent.getParameter("item").getKey();
      this.getView().getModel("security").setProperty("/typeKey", key);
      this._applyFilters();
    },

    onEmailChange(oEvent) {
      const val = (oEvent.getParameter("newValue") || "").trim();
      this.getView().getModel("security").setProperty("/emailFilter", val);
      this._applyFilters();
    },
    
onGoSystemHealth() {
  this.getOwnerComponent().getRouter().navTo("system", {}, false);
},
goRisk: function () {
  this.getOwnerComponent()
      .getRouter()
      .navTo("risk", {}, false);
},
    onIpChange(oEvent) {
      const val = (oEvent.getParameter("newValue") || "").trim();
      this.getView().getModel("security").setProperty("/ipFilter", val);
      this._applyFilters();
    },
onExportSecurityExcel: function(){

const API_BASE =
"https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

window.open(
 `${API_BASE}/security/export`,
 "_blank"
);

},
    // ============================================
    // Apply filters to the table
    // ============================================

    _applyFilters() {
      const m = this.getView().getModel("security");
      const all = m.getProperty("/all") || [];
      const typeKey = m.getProperty("/typeKey");
      const email = m.getProperty("/emailFilter");
      const ip = m.getProperty("/ipFilter");

      let rows = all.slice();

      if (typeKey && typeKey !== "ALL") {
        rows = rows.filter((r) => r.eventGroup === typeKey);
      }

      if (email) {
        rows = rows.filter((r) =>
          includesIC(r.user, email) ||
          includesIC(r.client, email) ||
          includesIC(r.origin, email)
        );
      }

      if (ip) {
        rows = rows.filter((r) => includesIC(r.ip, ip));
      }

      m.setProperty("/rows", rows);
    }

  });
});
