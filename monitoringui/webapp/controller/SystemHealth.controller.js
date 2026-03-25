sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {

  "use strict";

  return Controller.extend(
    "pwc.monitoring.monitoringui.controller.SystemHealth", {

      onInit: function () {

        const model = new JSONModel({});
        this.getView().setModel(model, "metrics");

        this._interval = setInterval(() => {
          this.onRefresh();
        }, 3000);

        this.onRefresh();
      },

      onRefresh: function () {

        const BACKEND =
          "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

        fetch(BACKEND + "/metrics/runtime", {
  method: "GET",
  credentials: "include"
})
          .then(r => r.json())
          .then(data => {

            // TEXT
            data.cpuText =
              (data.cpu || 0).toFixed(1) + " %";

            data.memText =
              (data.rss / 1024 / 1024).toFixed(1) + " MB";

            data.respText =
              (data.responseTimeMs || 0).toFixed(0) + " ms";

            data.gcText =
              (data.gcTimeMs || 0).toFixed(2) + " ms";

            data.heapText =
              (data.heapGrowthRate || 0) + " MB/min";

            data.healthText =
              (data.healthScore || 0) + " %";

            data.uptimeText =
              (data.uptimeSec || 0) + " sec";

            // STATES
            data.cpuState =
              data.cpu > 85 ? "Error" :
              data.cpu > 60 ? "Warning" :
              "Success";

            data.lagState =
              data.elLagMs > 250 ? "Error" :
              data.elLagMs > 80 ? "Warning" :
              "Success";

            data.respState =
              data.responseTimeMs > 500 ? "Error" :
              data.responseTimeMs > 200 ? "Warning" :
              "Success";

            data.gcState =
              data.gcTimeMs > 100 ? "Error" :
              data.gcTimeMs > 40 ? "Warning" :
              "Success";

            data.heapState =
              data.heapGrowthRate > 5 ? "Error" :
              data.heapGrowthRate > 2 ? "Warning" :
              "Success";

            data.healthState =
              data.healthScore < 40 ? "Error" :
              data.healthScore < 70 ? "Warning" :
              "Success";

            this.getView()
              .getModel("metrics")
              .setData(data);

          })
          .catch(err => {
            console.error("Runtime API error", err);
          });
      },

      onExit: function () {
        if (this._interval) {
          clearInterval(this._interval);
        }
      }

    });
});