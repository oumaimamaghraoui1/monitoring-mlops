sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
  "use strict";

  return Controller.extend("pwc.monitoring.monitoringui.controller.kmeans", {
    onSearch: async function () {
      const tcode = this.byId("tcodeInput").getValue().trim();

      if (!tcode) {
        MessageToast.show("Enter a T-Code");
        return;
      }

      try {
        const response = await fetch("/ai/recommend", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ tcode })
        });

        const payload = await response.json();
        const results = payload.results || [];

        const model = new JSONModel(results);
        this.getView().setModel(model, "recModel");

        if (!results.length) {
          MessageToast.show("No result found");
        }

      } catch (e) {
        console.error("AI request failed", e);
        MessageToast.show("AI request failed");
      }
    }
  });
});