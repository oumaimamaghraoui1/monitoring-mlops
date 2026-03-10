sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  function fmt(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function riskState(score) {
    if (score >= 0.8) return "Error";
    if (score >= 0.5) return "Warning";
    return "Success";
  }function cleanActor(actor) {

  if (!actor) return "";

  // Extract email after last slash
  const parts = actor.split("/");

  const last = parts[parts.length - 1];

  return last.includes("@") ? last : actor;

}

  return Controller.extend("pwc.monitoring.monitoringui.controller.Anomalies", {

    onInit() {

      const m = new JSONModel({
        loading: false,
        anomalies: []
      });

      this.getView().setModel(m, "anom");

      this.onRefresh();

    },

    _apiBase() {
      const origin = window.location.origin;
      return origin.replace(/port\d+-/, "port8090-");
    },

    async onRefresh() {

      const m = this.getView().getModel("anom");
      m.setProperty("/loading", true);

      const API = this._apiBase() + "/anomaly/anomalies";

      try {

        const r = await fetch(API, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);

        const rows = await r.json();

        const mapped = rows.map(e => ({
          actor: cleanActor(e.actor),
          collection: e.collection,
          timeFmt: fmt(e.when),
          anomaly: e.anomaly,
          riskState: riskState(e.anomaly)
        }));

        mapped.sort((a,b) =>
          new Date(b.timeFmt) - new Date(a.timeFmt)
        );

        m.setProperty("/anomalies", mapped);

      } catch (err) {

        console.error("[Anomalies] load failed:", err);
        m.setProperty("/anomalies", []);

      } finally {

        m.setProperty("/loading", false);

      }
    }

  });

});