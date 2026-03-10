sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  return Controller.extend("pwc.monitoring.monitoringui.controller.SystemHealth", {

    onInit() {
      const model = new JSONModel({
        cpu: 0,
        rss: 0,
        heapUsed: 0,
        heapTotal: 0,
        elLagMs: 0,
        uptimeSec: 0
      });

      this.getView().setModel(model, "metrics");

      this.onRefresh();
      this._interval = setInterval(() => this.onRefresh(), 5000);
    },

    onRefresh() {

      // IMPORTANT: FULL BACKEND URL ON PORT 8090 👇
      const BACKEND = 
        "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

      fetch(`${BACKEND}/metrics/runtime`, {
        method: "GET",
        credentials: "include"
      })
        .then(res => res.json())
        .then(data => {
          this.getView().getModel("metrics").setData(data);
        })
        .catch(err => {
          console.error("[SystemHealth] metrics load error:", err);
        });
    },

    onExit() {
      if (this._interval) clearInterval(this._interval);
    }

  });
});