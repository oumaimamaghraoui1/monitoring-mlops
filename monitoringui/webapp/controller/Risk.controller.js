sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], function (Controller, JSONModel, Filter, FilterOperator) {

  return Controller.extend("pwc.monitoring.monitoringui.controller.Risk", {

    onInit: function () {

      this.model = new JSONModel({
        logs: [],
        chartData: []
      });

      this.getView().setModel(this.model, "logs");

      this.loadData();

      this.interval = setInterval(() => {
        this.loadData();
      }, 10000);
    },

    loadData: function () {

      const API_BASE =
"https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

      fetch(`${API_BASE}/audit/scored`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {

          if (data.logs && data.logs.length > 0) {

            const logs = data.logs;
            const grouped = {};

logs.forEach(log => {

  const date = new Date(log.time)
    .toISOString()
    .slice(0,10);

  if (!grouped[date]) {

    grouped[date] = {
      date: date,
      High: 0,
      Medium: 0,
      Low: 0,
      Normal: 0
    };
  }

  grouped[date][log.risk]++;

});

const trendData = Object.values(grouped)
  .sort((a,b) => new Date(a.date) - new Date(b.date));

this.model.setProperty("/trendData", trendData);

            this.model.setProperty("/logs", logs);

            this.model.setProperty("/highCount",
              logs.filter(l => l.risk === "High").length
            );

            this.model.setProperty("/mediumCount",
              logs.filter(l => l.risk === "Medium").length
            );

            this.model.setProperty("/lowCount",
              logs.filter(l => l.risk === "Low").length
            );

            this.model.setProperty("/normalCount",
              logs.filter(l => l.risk === "Normal").length
            );

            // ✅ CHART DATA FIX
            const chartData = [
              { risk: "High", count: logs.filter(l => l.risk === "High").length },
              { risk: "Medium", count: logs.filter(l => l.risk === "Medium").length },
              { risk: "Low", count: logs.filter(l => l.risk === "Low").length },
              { risk: "Normal", count: logs.filter(l => l.risk === "Normal").length }
            ];

            this.model.setProperty("/chartData", chartData);

            this.getView().getModel("logs").refresh(true);
          }

        })
        .catch(err => console.log("Risk fetch error:", err));
    },

    onRiskFilter: function(oEvent) {

      const tile = oEvent.getSource();
      const risk = tile.getCustomData()[0].getValue();

      const table = this.getView().byId("riskTable");
      const binding = table.getBinding("items");

      if (!this.currentFilter) {

        const filter = new Filter("risk", FilterOperator.EQ, risk);
        binding.filter([filter]);
        this.currentFilter = risk;

      } else {

        binding.filter([]);
        this.currentFilter = null;

      }
    },

    formatOperation: function(details) {

      if (!details) return "Configuration Change";

      try {

        const obj = JSON.parse(details);

        if (obj["Resource Name"] && obj.Action) {

          if (obj["Parent Resource Type"] === "Tenant") {

            return "Tenant Parameter \"" +
                   obj["Resource Name"] +
                   "\" " +
                   obj.Action + "d";
          }
        }

        if (obj.tableName === "xsrolecollections" && obj.name) {

          if (obj.crudType === "CREATE") {
            return "Role Collection \"" + obj.name + "\" Created";
          }

          if (obj.crudType === "UPDATE") {
            return "Role Collection \"" + obj.name + "\" Updated";
          }
        }

        if (obj.crudType === "UPDATE" && obj.origin) {

          if (obj.origin.includes("sb-das")) {
            return "Application Configuration Updated";
          }
        }

        if (obj.crudType === "CREATE")
          return "Configuration Created";

        if (obj.crudType === "UPDATE")
          return "Configuration Updated";

        if (obj.crudType === "DELETE")
          return "Configuration Deleted";

        return "Administrative Configuration Change";

      } catch(e) {

        return details.length > 50
          ? "System Administrative Action"
          : details;
      }
    },

    onExit: function () {
      clearInterval(this.interval);
    },
 onGoSecurity: function () {
  this.getOwnerComponent().getRouter().navTo("security");
},
onGoDataChanges() {
  this.getOwnerComponent().getRouter().navTo("datachanges");
},
onGoSystemHealth() {
  this.getOwnerComponent().getRouter().navTo("system");
},
    formatScore: function(score) {
      return score ? score.toFixed(3) : "";
    }

  });

});