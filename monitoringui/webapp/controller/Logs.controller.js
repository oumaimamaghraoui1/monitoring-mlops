sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function includesIgnoreCase(hay, needle) {
    if (!needle) return true; // no filter
    if (!hay) return false;
    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.Logs", {

    onInit() {
      const m = new JSONModel({
        // raw list from backend
        all: [],
        // derived lists bound to tables
        human: [],
        system: [],
        // UI state
        hideUnknown: true,
        humanFilter: "ALL",
        systemFilter: "ALL",
        humanEmail: "",
        systemEmail: ""
      });
      this.getView().setModel(m, "logs");
      this.onRefresh();
    },

    // Logs.controller.js
onRefresh() {
  const API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";
  fetch(`${API_BASE}/audit/full`, { credentials: "include" })
    .then(async r => {
      if (!r.ok) {
        // Read as text to avoid JSON parse on HTML error pages
        const text = await r.text();
        throw new Error(`HTTP ${r.status} ${r.statusText}: ${text.slice(0, 200)}`);
      }
      return r.json();
    })
    .then(json => {
      const rows = Array.isArray(json.logs) ? json.logs : [];
      const normalized = rows.map(x => ({
        ...x,
        time: formatTime(x.time),
        actor: x.actor || "Unknown",
        target: x.target || "Unknown",
        objectType: x.objectType || "Configuration Change",
        action: x.action || "UPDATE",
        details: x.details || "",
        isHuman: !!x.isHuman
      }));
      normalized.sort((a, b) => new Date(b.time) - new Date(a.time));
      const model = this.getView().getModel("logs");
      model.setProperty("/all", normalized);
      this._applyFilters();
    })
    .catch(err => console.error("[UI] Failed to load logs:", err));
},
    // ===== Human Tab handlers =====
    onHumanFilterChange(e) {
      const key = e.getParameter("item").getKey();
      const m = this.getView().getModel("logs");
      m.setProperty("/humanFilter", key);
      this._applyFilters();
    },
    onHumanEmailChange(e) {
      const val = e.getParameter("newValue") || e.getSource().getValue() || "";
      const m = this.getView().getModel("logs");
      m.setProperty("/humanEmail", val.trim());
      this._applyFilters();
    },

    // ===== System Tab handlers =====
    onSystemFilterChange(e) {
      const key = e.getParameter("item").getKey();
      const m = this.getView().getModel("logs");
      m.setProperty("/systemFilter", key);
      this._applyFilters();
    },
    onSystemEmailChange(e) {
      const val = e.getParameter("newValue") || e.getSource().getValue() || "";
      const m = this.getView().getModel("logs");
      m.setProperty("/systemEmail", val.trim());
      this._applyFilters();
    },

    onToggleUnknown() {
      this._applyFilters();
    },
   
  onGoSecurity: function () {
  this.getOwnerComponent()
    .getRouter()
    .navTo("security", {}, false);
},
onGoDataChanges() {
  this.getOwnerComponent().getRouter().navTo("datachanges", {}, false);
},
onGoSystemHealth() {
  this.getOwnerComponent().getRouter().navTo("system", {}, false);
},
onGoAnomalies() {
  this.getOwnerComponent()
    .getRouter()
    .navTo("anomalies", {}, false);
},
goRisk: function () {
  this.getOwnerComponent()
      .getRouter()
      .navTo("risk", {}, false);
},
goKmeans: function () {this.getOwnerComponent().getRouter().navTo("kmeans", {}, false);},
    // ===== Core filterer =====
    _applyFilters() {
      const m = this.getView().getModel("logs");
      const all = m.getProperty("/all");
      const hideUnknown = m.getProperty("/hideUnknown");

      // Human filters
      const hType = m.getProperty("/humanFilter");   // ALL / Role Assignment / User Profile Update / Configuration Change
      const hEmail = m.getProperty("/humanEmail");   // free text, matches actor OR target

      let human = all.filter(x => x.isHuman);
      if (hideUnknown) human = human.filter(x => x.actor !== "Unknown");
      if (hType !== "ALL") human = human.filter(x => x.objectType === hType);
      if (hEmail) {
        human = human.filter(x =>
          includesIgnoreCase(x.actor, hEmail) || includesIgnoreCase(x.target, hEmail)
        );
      }
      

      // System filters
      const sType = m.getProperty("/systemFilter");  // ALL / Deployment / Configuration Change
      const sEmail = m.getProperty("/systemEmail");

      let system = all.filter(x => !x.isHuman);
      if (sType !== "ALL") system = system.filter(x => x.objectType === sType);
      if (sEmail) {
        system = system.filter(x =>
          includesIgnoreCase(x.actor, sEmail) || includesIgnoreCase(x.target, sEmail)
        );
      }

      m.setProperty("/human", human);
      m.setProperty("/system", system);
    }

  });
  
});
