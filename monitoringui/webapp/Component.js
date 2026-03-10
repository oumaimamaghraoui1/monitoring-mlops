sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "pwc/monitoring/monitoringui/model/anomalyModel"
], function (UIComponent, JSONModel, anomalyModel) {
  "use strict";

  return UIComponent.extend("pwc.monitoring.monitoringui.Component", {

    metadata: {
      manifest: "json"
    },

    init: function () {

      // call parent init
      UIComponent.prototype.init.apply(this, arguments);

      // include css
      jQuery.sap.includeStyleSheet("css/style.css");

      // initialize router
      this.getRouter().initialize();

      // ✅ SET ANOMALY MODEL HERE (INSIDE INIT)
      this.setModel(
        anomalyModel.load(),
        "anomaly"
      );

    }

  });

});