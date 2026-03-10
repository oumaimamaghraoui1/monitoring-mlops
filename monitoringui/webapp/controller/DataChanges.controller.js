sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter"
], function (Controller, JSONModel, Filter) {
  "use strict";

  function fmt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function stateForAction(action) {
    switch (action) {
      case "STARTING": return "Warning";
      case "STARTED":  return "Success";
      case "FAILED":   return "Error";
      case "STOPPED":  return "None";
      default:         return "None";
    }
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.DataChanges", {

    onInit() {
      const m = new JSONModel({
        loading: false,
        workspace: { all: [], filter: "" }
      });
      this.getView().setModel(m, "datachg");
      this.onRefresh();
    },

    _apiBase() {
      // Map UI origin (portXXXX-) → backend origin (port8090-)
      const origin = window.location.origin;
      return origin.replace(/port\d+-/, "port8090-");
    },

    async onRefresh() {
      const m = this.getView().getModel("datachg");
      m.setProperty("/loading", true);

      const API = this._apiBase() + "/data/full";

      try {
        const r = await fetch(API, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        const json = await r.json();
        const rows = Array.isArray(json.logs) ? json.logs : [];

        const ws = [];

        for (const l of rows) {
          const category = l?.category;

          // Parse embedded message JSON (if present)
          let msg = {};
          try { msg = JSON.parse(l?.raw?.message || "{}"); } catch (_) {}

          // Only keep workspace events
          if (category === "audit.data-modification") {
            // attributes[0].name is itself a JSON string with workspace info
            let inner = {};
            try {
              const a0 = msg.attributes?.[0];
              inner = a0 ? JSON.parse(a0.name || "{}") : {};
            } catch (_) {}

            // Skip useless/empty lines
            if (!inner.workspace_id && !inner.message) continue;

            const action = inner.action || "";

            ws.push({
              uuid: l.uuid,
              time: l.time,
              timeFmt: fmt(l.time),
              workspace:   inner.workspace_id || "",
              action,
              actionState: stateForAction(action),
              started_by:  inner.started_by || "",
              message:     inner.message || ""
            });
          }
        }

        // newest first
        ws.sort((a,b) => new Date(b.time) - new Date(a.time));

        m.setProperty("/workspace/all", ws);

        // re-apply current text filter after refresh
        this._applyWorkspaceFilter(m.getProperty("/workspace/filter"));

      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[DataChanges] load failed:", err);
        m.setProperty("/workspace/all", []);
      } finally {
        m.setProperty("/loading", false);
      }
    },

    // -----------------------------
    // Filtering (controller-side)
    // -----------------------------
    onFilterWorkspace(e) {
      const val = (e.getParameter("newValue") || e.getSource().getValue() || "")
        .trim().toLowerCase();
      this.getView().getModel("datachg").setProperty("/workspace/filter", val);
      this._applyWorkspaceFilter(val);
    },

    _applyWorkspaceFilter(val) {
      const tbl = this.byId("tblWorkspace");
      const b = tbl && tbl.getBinding("items");
      if (!b) return;

      if (!val) {
        b.filter([]);
        return;
      }

      const f = new Filter({
        path: ".",               // entire row object
        test: (row) => {
          const hay = [
            row.workspace, row.action, row.started_by, row.message, row.timeFmt, row.uuid
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(val);
        }
      });

      b.filter([f]);
    },

    // Navigation (unchanged)
    onGoLogs()     { this.getOwnerComponent().getRouter().navTo("logs");     },
    onGoSecurity() { this.getOwnerComponent().getRouter().navTo("security"); }

  });
});