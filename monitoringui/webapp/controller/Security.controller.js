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
    return hay.toLowerCase().includes(needle.toLowerCase());
  }

  function mapTypeToGroup(t) {
    if (!t) return "OTHER";
    if (t.includes("UserAuthenticationSuccess")) return "LOGIN";
    if (t.includes("IdentityProviderAuthenticationSuccess")) return "LOGIN";
    if (t.includes("TokenIssuedEvent")) return "TOKEN";
    if (t.includes("ClientAuthenticationSuccess")) return "CLIENT";
    return "OTHER";
  }

  // ============================================
  // Data‑cleaning helpers
  // ============================================

  function cleanUserField(user) {
    if (!user) return "Unknown";

    // Try parse JSON payload (XSUAA sometimes dumps user JSON)
    try {
      const obj = JSON.parse(user);
      if (obj.email) return obj.email;
      if (obj.user_name) return obj.user_name;
      if (obj.given_name && obj.family_name)
        return obj.given_name + " " + obj.family_name;
    } catch (e) {}

    // If it’s just an email
    if (user.includes("@")) return user.trim();

    // Otherwise remove quotes
    return user.replace(/\"/g, "").trim();
  }

  function cleanClientField(client) {
    if (!client) return "Unknown";

    // Example: sb-clone...|destination-xsappname!b404
    const parts = client.split("|");
    if (parts.length > 1) {
      return parts[1].split("!")[0]; // destination-xsappname
    }

    // Example: destination-xsappname!b404
    return client.split("!")[0];
  }

  function cleanOriginField(origin) {
    if (!origin) return "N/A";

    const parts = origin.split("|");
    if (parts.length > 1) {
      return parts[1].split("!")[0];
    }

    return origin;
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

    // fallback: short message
    if (ev.message && ev.message.length > 80) {
      return ev.message.slice(0, 80) + "...";
    }

    return ev.message || "";
  }

  // ============================================
  // MAIN CONTROLLER
  // ============================================

  return Controller.extend("pwc.monitoring.monitoringui.controller.Security", {

    onInit() {
      const model = new JSONModel({
        all: [],
        rows: [],
        typeKey: "ALL",
        emailFilter: "",
        ipFilter: ""
      });
      this.getView().setModel(model, "security");
      this.onRefresh();
    },

    // Security.controller.js

onRefresh() {
  // Use the 8090 UI origin of your backend in BAS:
  const API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

  fetch(`${API_BASE}/security/events`, { credentials: "include" })
    .then(async (r) => {
      if (!r.ok) {
        const text = await r.text(); // avoid JSON.parse on HTML error pages
        throw new Error(`HTTP ${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
      }
      return r.json();
    })
    .then((json) => {
      const arr = Array.isArray(json.logs) ? json.logs : [];

      const norm = arr.map((ev) => {
        const user = cleanUserField(ev.user);
        const client = cleanClientField(ev.client);
        const origin = cleanOriginField(ev.origin);
        const msg = summarizeMessage(ev);
        return {
          ...ev,
          user,
          client,
          origin,
          message: msg,
          time: formatTime(ev.time),
          eventGroup: mapTypeToGroup(ev.eventType)
        };
      });

      norm.sort((a, b) => new Date(b.time) - new Date(a.time));

      const m = this.getView().getModel("security");
      m.setProperty("/all", norm);
      this._applyFilters();
    })
    .catch((err) => console.error("[SEC] Load failed", err));
},

    onBack() {
      this.getOwnerComponent().getRouter().navTo("logs");
    },

    // ========================================================
    // Filter handlers
    // ========================================================
    onTypeChange(e) {
      this.getView().getModel("security").setProperty(
        "/typeKey",
        e.getParameter("item").getKey()
      );
      this._applyFilters();
    },

    onEmailChange(e) {
      const val = (e.getParameter("newValue") || "").trim();
      this.getView().getModel("security").setProperty("/emailFilter", val);
      this._applyFilters();
    },

    onIpChange(e) {
      const val = (e.getParameter("newValue") || "").trim();
      this.getView().getModel("security").setProperty("/ipFilter", val);
      this._applyFilters();
    },

onGoDataChanges() {
  this.getOwnerComponent().getRouter().navTo("datachanges");
},
onGoLogs()     { this.getOwnerComponent().getRouter().navTo("logs")},
    // ========================================================
    // Apply filters to the table
    // ========================================================
    _applyFilters() {
      const m = this.getView().getModel("security");
      const all = m.getProperty("/all");
      const typeKey = m.getProperty("/typeKey");
      const email = m.getProperty("/emailFilter");
      const ip = m.getProperty("/ipFilter");

      let rows = all.slice();

      if (typeKey !== "ALL") {
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