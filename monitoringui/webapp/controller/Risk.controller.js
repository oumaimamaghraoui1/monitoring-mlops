sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/export/Spreadsheet",
  "sap/m/MessageToast"
], function (Controller, JSONModel, Spreadsheet, MessageToast) {
  "use strict";

  function includesIC(hay, needle) {
    if (!needle) {
      return true;
    }

    if (!hay) {
      return false;
    }

    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  function formatTime(iso) {
    if (!iso) {
      return "";
    }

    var d = new Date(iso);

    if (isNaN(d.getTime())) {
      return String(iso);
    }

    var pad = function (n) {
      return String(n).padStart(2, "0");
    };

    return (
      d.getFullYear() + "-" +
      pad(d.getMonth() + 1) + "-" +
      pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" +
      pad(d.getMinutes()) + ":" +
      pad(d.getSeconds())
    );
  }

  function riskToState(risk) {
    if (risk === "High") {
      return "Error";
    }

    if (risk === "Medium") {
      return "Warning";
    }

    if (risk === "Low") {
      return "Information";
    }

    if (risk === "Normal") {
      return "Success";
    }

    return "None";
  }

  function formatOperationValue(details) {
    if (!details) {
      return "Configuration Change";
    }

    try {
      var obj =
        typeof details === "string"
          ? JSON.parse(details)
          : details;

      if (obj.rolecollection_name) {
        return 'Role Collection "' + obj.rolecollection_name + '" ' + (obj.crudType || "Updated");
      }

      if (obj["Resource Name"]) {
        return 'Tenant Parameter "' + obj["Resource Name"] + '" ' + (obj.Action || "Modified");
      }

      if (obj.origin) {
        return "Application Configuration Updated";
      }

      if (obj.tableName) {
        return obj.tableName + " " + (obj.crudType || "");
      }

      if (obj.objectId) {
        return "Configuration updated (" + obj.objectId + ")";
      }

      if (obj.action) {
        return String(obj.action);
      }
    } catch (e) {
      // not JSON, continue
    }

    return String(details);
  }

  function getExportColumns() {
    return [
      {
        label: "Time",
        property: "time",
        width: 22
      },
      {
        label: "Risk",
        property: "risk",
        width: 14
      },
      {
        label: "Risk State",
        property: "riskState",
        width: 16
      },
      {
        label: "Anomaly Score",
        property: "anomalyScore",
        width: 18
      },
      {
        label: "Operation",
        property: "operation",
        width: 60
      },
      {
        label: "Actor",
        property: "actor",
        width: 32
      },
      {
        label: "Target",
        property: "target",
        width: 32
      },
      {
        label: "Action",
        property: "action",
        width: 16
      },
      {
        label: "Object Type",
        property: "objectType",
        width: 24
      },
      {
        label: "Details",
        property: "detailsText",
        width: 70
      }
    ];
  }

  function exportRowsToExcel(rows) {
    var count = rows.length;

    var timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    var sheet = new Spreadsheet({
      workbook: {
        columns: getExportColumns()
      },
      dataSource: rows,
      fileName: "AI_Risk_Events_FILTERED_" + count + "_rows_" + timestamp + ".xlsx"
    });

    return sheet.build()
      .finally(function () {
        sheet.destroy();
      });
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.Risk", {

    onInit: function () {
      this.model = new JSONModel({
        allLogs: [],
        logs: [],
        trendData: [],
        pieData: [],
        lastAuditDate: "-",
        riskFilter: "ALL",
        searchText: "",
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        normalCount: 0
      });

      this.getView().setModel(this.model, "logs");

      this.loadData();

      this.interval = setInterval(function () {
        this.loadData();
      }.bind(this), 10000);
    },

    // ================= ISO WEEK =================

    getISOWeek: function (date) {
      var d = new Date(Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      ));

      var dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);

      var yearStart =
        new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

      var week = Math.ceil(
        (((d - yearStart) / 86400000) + 1) / 7
      );

      return {
        year: d.getUTCFullYear(),
        week: week.toString().padStart(2, "0")
      };
    },

    // ================= LOAD DATA =================

    loadData: function () {
      var API_BASE =
        "/backend";

      fetch(API_BASE + "/audit/scored", {
        credentials: "include"
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (text) {
              throw new Error("HTTP " + res.status + ": " + text.slice(0, 200));
            });
          }

          return res.json();
        })
        .then(function (data) {
          var rawLogs = Array.isArray(data.logs) ? data.logs : [];

          if (!rawLogs.length) {
            this.model.setProperty("/allLogs", []);
            this.model.setProperty("/logs", []);
            this.model.setProperty("/trendData", []);
            this.model.setProperty("/pieData", []);
            this.model.setProperty("/lastAuditDate", "-");
            this.model.setProperty("/highCount", 0);
            this.model.setProperty("/mediumCount", 0);
            this.model.setProperty("/lowCount", 0);
            this.model.setProperty("/normalCount", 0);
            return;
          }

          var logs = rawLogs.map(function (log) {
            var risk = log.risk || "Normal";

            var operation = formatOperationValue(log.details);

            var actor =
              log.actor ||
              (log.raw && log.raw.user) ||
              log.user ||
              "Unknown";

            var target =
              log.target ||
              log.object ||
              log.objectId ||
              "Unknown";

            var objectType =
              log.objectType ||
              log.type ||
              "Configuration Change";

            var action =
              log.action ||
              log.crudType ||
              "OTHER";

            var detailsText =
              typeof log.details === "string"
                ? log.details
                : JSON.stringify(log.details || "");

            return {
              uuid: log.uuid || "",
              time: formatTime(log.time),
              originalTime: log.time || "",
              operation: operation,
              details: log.details,
              detailsText: detailsText,
              actor: actor,
              target: target,
              objectType: objectType,
              action: action,
              anomalyScore:
                log.anomalyScore !== undefined && log.anomalyScore !== null
                  ? Number(log.anomalyScore)
                  : 0,
              risk: risk,
              riskState: log.riskState || riskToState(risk),
              raw: log.raw || null
            };
          });

          logs.sort(function (a, b) {
            return new Date(b.originalTime || b.time) - new Date(a.originalTime || a.time);
          });

          // ================= LAST AUDIT DATE =================

          var newestLog = logs.reduce(function (a, b) {
            return new Date(a.originalTime || a.time) > new Date(b.originalTime || b.time) ? a : b;
          });

          this.model.setProperty(
            "/lastAuditDate",
            newestLog ? (newestLog.originalTime || newestLog.time || "-") : "-"
          );

          // ================= GROUP BY WEEK =================

          var grouped = {};

          logs.forEach(function (log) {
            if (!log.originalTime && !log.time) {
              return;
            }

            if (!log.risk) {
              return;
            }

            var d = new Date(log.originalTime || log.time);

            if (isNaN(d.getTime())) {
              return;
            }

            var w = this.getISOWeek(d);

            var weekKey = w.year + "-W" + w.week;

            if (!grouped[weekKey]) {
              grouped[weekKey] = {
                week: weekKey,
                High: 0,
                Medium: 0,
                Low: 0,
                Normal: 0
              };
            }

            if (grouped[weekKey][log.risk] !== undefined) {
              grouped[weekKey][log.risk]++;
            }
          }.bind(this));

          var trendData =
            Object.values(grouped)
              .sort(function (a, b) {
                var aParts = a.week.split("-W");
                var bParts = b.week.split("-W");

                var ya = Number(aParts[0]);
                var wa = Number(aParts[1]);

                var yb = Number(bParts[0]);
                var wb = Number(bParts[1]);

                return (ya * 100 + wa) - (yb * 100 + wb);
              });

          this.model.setProperty("/trendData", trendData);

          // ================= DONUT COMPOSITION =================

          var totalHigh =
            logs.filter(function (l) {
              return l.risk === "High";
            }).length;

          var totalMedium =
            logs.filter(function (l) {
              return l.risk === "Medium";
            }).length;

          var totalLow =
            logs.filter(function (l) {
              return l.risk === "Low";
            }).length;

          var totalNormal =
            logs.filter(function (l) {
              return l.risk === "Normal";
            }).length;

          var total =
            totalHigh +
            totalMedium +
            totalLow +
            totalNormal;

          this.model.setProperty("/pieData", [
            {
              risk: "High",
              value: total ? (totalHigh / total) * 100 : 0
            },
            {
              risk: "Medium",
              value: total ? (totalMedium / total) * 100 : 0
            },
            {
              risk: "Low",
              value: total ? (totalLow / total) * 100 : 0
            },
            {
              risk: "Normal",
              value: total ? (totalNormal / total) * 100 : 0
            }
          ]);

          // ================= KPI =================

          this.model.setProperty("/highCount", totalHigh);
          this.model.setProperty("/mediumCount", totalMedium);
          this.model.setProperty("/lowCount", totalLow);
          this.model.setProperty("/normalCount", totalNormal);

          this.model.setProperty("/allLogs", logs);

          this._applyFilters();

          this.getView()
            .getModel("logs")
            .refresh(true);
        }.bind(this))
        .catch(function (err) {
          console.log("Risk fetch error:", err);
        });
    },

    onRefresh: function () {
      this.loadData();
    },

    onBack: function () {
      this.getOwnerComponent()
        .getRouter()
        .navTo("logs", {}, false);
    },

    // ================= FORMATTERS =================

    formatOperation: function (details) {
      return formatOperationValue(details);
    },

    formatScore: function (score) {
      if (score === undefined || score === null || score === "") {
        return "";
      }

      var n = Number(score);

      if (isNaN(n)) {
        return "";
      }

      return n.toFixed(3);
    },

    // ================= FILTERS =================

    onRiskSelectionChange: function (oEvent) {
      var key = oEvent.getParameter("item").getKey();

      this.model.setProperty("/riskFilter", key);
      this._applyFilters();
    },

    onSearchChange: function (oEvent) {
      var val =
        oEvent.getParameter("newValue") ||
        oEvent.getSource().getValue() ||
        "";

      this.model.setProperty("/searchText", val.trim());
      this._applyFilters();
    },

    onClearRiskFilters: function () {
      this.model.setProperty("/riskFilter", "ALL");
      this.model.setProperty("/searchText", "");

      var seg = this.byId("sbRiskFilter");
      if (seg) {
        seg.setSelectedKey("ALL");
      }

      var search = this.byId("sfRiskSearch");
      if (search) {
        search.setValue("");
      }

      this._applyFilters();
    },

    _applyFilters: function () {
      var all = this.model.getProperty("/allLogs") || [];
      var riskFilter = this.model.getProperty("/riskFilter") || "ALL";
      var searchText = this.model.getProperty("/searchText") || "";

      var rows = all.slice();

      if (riskFilter !== "ALL") {
        rows = rows.filter(function (r) {
          return r.risk === riskFilter;
        });
      }

      if (searchText) {
        rows = rows.filter(function (r) {
          return (
            includesIC(r.operation, searchText) ||
            includesIC(r.detailsText, searchText) ||
            includesIC(r.actor, searchText) ||
            includesIC(r.target, searchText) ||
            includesIC(r.objectType, searchText) ||
            includesIC(r.action, searchText) ||
            includesIC(r.risk, searchText)
          );
        });
      }

      this.model.setProperty("/logs", rows);
    },

    // ================= EXPORT =================

    onExportFilteredExcel: function () {
      var rows = this.model.getProperty("/logs") || [];
      var count = rows.length;

      MessageToast.show("Exporting " + count + " filtered risk rows");

      console.log("[EXPORT FILTERED RISK] rows count:", count);
      console.log("[EXPORT FILTERED RISK] rows:", rows);

      exportRowsToExcel(rows)
        .then(function () {
          MessageToast.show("Risk Excel exported: " + count + " rows");
        })
        .catch(function (err) {
          console.error("[EXPORT FILTERED RISK] failed:", err);
          MessageToast.show("Risk Excel export failed");
        });
    },

    onExportExcel: function () {
      this.onExportFilteredExcel();
    },

    // ================= NAVIGATION =================

    onGoSecurity: function () {
      this.getOwnerComponent()
        .getRouter()
        .navTo("security");
    },

    goKmeans: function () {
      this.getOwnerComponent()
        .getRouter()
        .navTo("kmeans", {}, false);
    },

    onGoDataChanges: function () {
      this.getOwnerComponent()
        .getRouter()
        .navTo("datachanges");
    },
    onGoAudit: function () {
  this.getOwnerComponent()
    .getRouter()
    .navTo("logs", {}, false);
},

    onGoSystemHealth: function () {
      this.getOwnerComponent()
        .getRouter()
        .navTo("system");
    },

    onExit: function () {
      if (this.interval) {
        clearInterval(this.interval);
      }
    }

  });
});