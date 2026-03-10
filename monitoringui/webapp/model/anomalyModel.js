sap.ui.define([
  "sap/ui/model/json/JSONModel"
], function (JSONModel) {
  "use strict";

  return {

    load: function () {

      const model = new JSONModel();

      fetch("/anomaly/anomalies")
        .then(res => res.json())
        .then(data => {

          data.forEach(e => {

            if (e.anomaly >= 0.8) {
              e.risk = "High";
            } else if (e.anomaly >= 0.5) {
              e.risk = "Medium";
            } else {
              e.risk = "Low";
            }

          });

          model.setData({
            anomalies: data
          });

        });

      return model;
    }

  };

});