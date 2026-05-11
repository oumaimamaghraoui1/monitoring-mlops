sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/export/Spreadsheet",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/viz/ui5/controls/Popover"
], function (Controller, JSONModel, Spreadsheet, MessageToast, MessageBox, Popover) {
  "use strict";

  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  var API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

  var API_CANDIDATES = [
    API_BASE + "/security/events",
    "/security/events"
  ];

  function fetchJsonWithFallback(urls) {
    var lastError = null;

    function tryOne(index) {
      if (index >= urls.length) {
        throw lastError || new Error("All API endpoints failed");
      }

      var url = urls[index];

      console.log("[SEC] Trying API:", url);

      return fetch(url, {
        credentials: "include"
      })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (text) {
              throw new Error(
                "HTTP " + r.status + " " + r.statusText + ": " + text.slice(0, 200)
              );
            });
          }

          return r.json();
        })
        .catch(function (err) {
          console.warn("[SEC] API failed:", url, err);
          lastError = err;
          return tryOne(index + 1);
        });
    }

    return tryOne(0);
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

  function includesIC(hay, needle) {
    if (!needle) {
      return true;
    }

    if (!hay) {
      return false;
    }

    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  function mapTypeToGroup(value) {
    var t = String(value || "").toLowerCase();

    if (
      t.indexOf("tokenissuedevent") > -1 ||
      t.indexOf("tokenissued") > -1 ||
      t.indexOf("token") > -1 ||
      t.indexOf("oauth") > -1 ||
      t.indexOf("jwt") > -1
    ) {
      return "TOKEN";
    }

    if (
      t.indexOf("clientauthenticationsuccess") > -1 ||
      t.indexOf("clientauthentication") > -1 ||
      t.indexOf("clientauth") > -1 ||
      t.indexOf("client auth") > -1
    ) {
      return "CLIENT";
    }

    if (
      t.indexOf("userauthenticationsuccess") > -1 ||
      t.indexOf("identityproviderauthenticationsuccess") > -1 ||
      t.indexOf("login") > -1 ||
      t.indexOf("authentication") > -1 ||
      t.indexOf("authsuccess") > -1 ||
      t.indexOf("logon") > -1
    ) {
      return "LOGIN";
    }

    if (t.indexOf("client") > -1) {
      return "CLIENT";
    }

    return "OTHER";
  }

  function getRowGroup(row) {
    if (row && row.eventGroup) {
      var g = String(row.eventGroup).toUpperCase();

      if (g === "LOGIN" || g === "TOKEN" || g === "CLIENT" || g === "OTHER") {
        return g;
      }
    }

    return mapTypeToGroup(
      String((row && row.eventType) || "") + " " +
      String((row && row.message) || "") + " " +
      String((row && row.client) || "")
    );
  }

  function normalizeValueState(state) {
    if (state === "Error") {
      return "Error";
    }

    if (state === "Warning") {
      return "Warning";
    }

    if (state === "Success") {
      return "Success";
    }

    if (state === "Information") {
      return "Information";
    }

    if (state === "Critical") {
      return "Warning";
    }

    return "None";
  }

  function stateFromRisk(risk) {
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

  function riskFromNormalizedScore(score, anomaly, backendRisk) {
    var s = Number(score || 0);
    var a = Number(anomaly || 1);

    if (
      backendRisk === "High" ||
      backendRisk === "Medium" ||
      backendRisk === "Low" ||
      backendRisk === "Normal"
    ) {
      return backendRisk;
    }

    if (a === -1 && s >= 0.65) {
      return "High";
    }

    if (s >= 0.85) {
      return "High";
    }

    if (s >= 0.65) {
      return "Medium";
    }

    if (s >= 0.40) {
      return "Low";
    }

    return "Normal";
  }

  function collectNestedStrings(obj, out) {
    out = out || [];

    if (!obj) {
      return out;
    }

    if (typeof obj === "string") {
      out.push(obj);
      return out;
    }

    if (Array.isArray(obj)) {
      obj.forEach(function (x) {
        collectNestedStrings(x, out);
      });
      return out;
    }

    if (typeof obj === "object") {
      Object.keys(obj).forEach(function (k) {
        collectNestedStrings(obj[k], out);
      });
      return out;
    }

    return out;
  }

  function extractEmailDeep(ev) {
    if (ev && ev.user && EMAIL_RE.test(String(ev.user))) {
      var m1 = String(ev.user).match(EMAIL_RE);

      if (m1) {
        return m1[0].toLowerCase();
      }
    }

    var strings = collectNestedStrings(ev);

    for (var i = 0; i < strings.length; i++) {
      var m2 = String(strings[i]).match(EMAIL_RE);

      if (m2) {
        return m2[0].toLowerCase();
      }
    }

    return "Unknown";
  }

  function normalizeClient(client) {
    if (!client) {
      return "Unknown";
    }

    var c = String(client).replace(/\"/g, "").trim();

    if (c.indexOf("sb-") > -1 || c.indexOf("|") > -1) {
      var afterPipe = c.split("|")[1];
      var label = afterPipe ? afterPipe.split("!")[0] : c;
      return label + " (" + c + ")";
    }

    return c;
  }

  function extractClientDeep(ev) {
    if (ev && ev.client && ev.client !== "Unknown") {
      return normalizeClient(ev.client);
    }

    var strings = collectNestedStrings(ev);

    for (var i = 0; i < strings.length; i++) {
      var str = String(strings[i]);

      var m =
        /"client_id"\s*:\s*"([^"]+)"/.exec(str) ||
        /"cid"\s*:\s*"([^"]+)"/.exec(str) ||
        /"azp"\s*:\s*"([^"]+)"/.exec(str) ||
        /clientId=([^,\]]+)/.exec(str);

      if (m && m[1]) {
        return normalizeClient(m[1]);
      }

      if (str.indexOf("sb-") > -1 && (str.indexOf("|") > -1 || str.indexOf("!") > -1)) {
        return normalizeClient(str);
      }
    }

    return "Unknown";
  }

  function cleanOriginField(origin) {
    if (!origin) {
      return "N/A";
    }

    return String(origin);
  }

  function summarizeMessage(ev) {
    var t = ev.eventType || "";
    var user = ev.user || "Unknown";
    var client = ev.client || "Unknown";

    if (t.indexOf("UserAuthenticationSuccess") > -1) {
      return "User login success (" + user + ")";
    }

    if (t.indexOf("IdentityProviderAuthenticationSuccess") > -1) {
      return "Login via identity provider (" + user + ")";
    }

    if (t.indexOf("ClientAuthenticationSuccess") > -1) {
      return "Client authenticated (" + client + ")";
    }

    if (t.indexOf("TokenIssuedEvent") > -1) {
      return "Token issued for " + user + " via " + client;
    }

    if (ev.message && ev.message.length > 80) {
      return ev.message.slice(0, 80) + "...";
    }

    return ev.message || "";
  }

  function getSecurityExportColumns() {
    return [
      { label: "Time", property: "time", width: 22 },
      { label: "User", property: "user", width: 35 },
      { label: "Risk", property: "risk", width: 14 },
      { label: "Risk State", property: "riskState", width: 16 },
      { label: "Event Group", property: "eventGroup", width: 16 },
      { label: "Event Type", property: "eventType", width: 45 },
      { label: "IP", property: "ip", width: 20 },
      { label: "Client", property: "client", width: 45 },
      { label: "Origin", property: "origin", width: 30 },
      { label: "Message", property: "message", width: 60 },
      { label: "Anomaly Score", property: "anomalyScore", width: 18 }
    ];
  }

  function exportSecurityRowsToExcel(rows) {
    var count = rows.length;

    var timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    var sheet = new Spreadsheet({
      workbook: {
        columns: getSecurityExportColumns()
      },
      dataSource: rows,
      fileName: "Security_Events_FILTERED_" + count + "_rows_" + timestamp + ".xlsx"
    });

    return sheet.build()
      .finally(function () {
        sheet.destroy();
      });
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.Security", {

    onInit: function () {
      var model = new JSONModel({
        all: [],
        rows: [],
        typeKey: "ALL",
        emailFilter: "",
        ipFilter: "",
        widgetRiskFilter: "",
        widgetGroupFilter: "",
        firstAuditDate: "",
        lastAuditDate: "",
        coverageText: "",
        userChart: [],
        hourChart: [],
        kpi: {
          high: 0,
          medium: 0,
          low: 0,
          loginCount: 0,
          tokenCount: 0,
          clientCount: 0,
          otherCount: 0
        }
      });

      this.getView().setModel(model, "security");

      this._oRiskLinePopover = new Popover({
        formatString: "#,##0"
      });

      this.onRefresh();
    },

    onAfterRendering: function () {
      this._configureRiskLineChart();
      this._connectLinePopover();
      this._bindWidgetFilters();
      this._updateWidgetActiveStyles();
    },

    _configureRiskLineChart: function () {
      var oChart = this.byId("idRiskLine");

      if (!oChart) {
        return;
      }

      oChart.setVizProperties({
        plotArea: {
          colorPalette: ["#2563eb"],
          dataLabel: {
            visible: false
          },
          marker: {
            visible: true,
            size: 7
          }
        },
        tooltip: {
          visible: true
        },
        interaction: {
          behaviorType: "default"
        },
        valueAxis: {
          title: {
            visible: true,
            text: "Risk Events"
          }
        },
        categoryAxis: {
          title: {
            visible: true,
            text: "Hour of Day"
          }
        },
        legend: {
          visible: true
        },
        title: {
          visible: false
        }
      });
    },

    _connectLinePopover: function () {
      var oChart = this.byId("idRiskLine");

      if (oChart && this._oRiskLinePopover) {
        this._oRiskLinePopover.connect(oChart.getVizUid());
      }
    },

    onRefresh: function () {
      fetchJsonWithFallback(API_CANDIDATES)
        .then(function (json) {
          var arr = Array.isArray(json.logs) ? json.logs : [];

          var norm = arr.map(function (ev) {
            var score =
              ev.anomalyScore !== undefined && ev.anomalyScore !== null
                ? Number(ev.anomalyScore)
                : 0;

            if (isNaN(score)) {
              score = 0;
            }

            var user = extractEmailDeep(ev);
            var client = extractClientDeep(ev);
            var origin = cleanOriginField(ev.origin);

            var eventGroup = getRowGroup({
              eventGroup: ev.eventGroup,
              eventType: ev.eventType,
              message: ev.message,
              client: client
            });

            var msg = summarizeMessage(Object.assign({}, ev, {
              user: user,
              client: client
            }));

            var backendRisk = ev.mlRisk || ev.risk || "";
            var risk = riskFromNormalizedScore(score, ev.anomaly, backendRisk);
            var riskState = normalizeValueState(ev.riskState || stateFromRisk(risk));

            return Object.assign({}, ev, {
              user: user,
              client: client,
              origin: origin,
              message: msg,
              originalTime: ev.time,
              time: formatTime(ev.time),
              eventGroup: eventGroup,
              anomalyScore: score,
              anomaly:
                ev.anomaly !== undefined && ev.anomaly !== null
                  ? Number(ev.anomaly)
                  : 1,
              risk: risk,
              riskState: riskState
            });
          });

          norm.sort(function (a, b) {
            return new Date(b.originalTime || b.time) - new Date(a.originalTime || a.time);
          });

          var m = this.getView().getModel("security");

          m.setProperty("/all", norm);

          var firstAuditDate = "";
          var lastAuditDate = "";

          if (norm.length) {
            var asc = norm.slice().sort(function (a, b) {
              return new Date(a.originalTime || a.time) - new Date(b.originalTime || b.time);
            });

            firstAuditDate = formatTime(asc[0].originalTime || asc[0].time);
            lastAuditDate = formatTime(asc[asc.length - 1].originalTime || asc[asc.length - 1].time);
          }

          m.setProperty("/firstAuditDate", firstAuditDate);
          m.setProperty("/lastAuditDate", lastAuditDate || formatTime(json.lastAuditDate || ""));
          m.setProperty(
            "/coverageText",
            firstAuditDate && lastAuditDate
              ? firstAuditDate + "  →  " + lastAuditDate
              : ""
          );

          var hourCounts = {};

          for (var i = 0; i < 24; i++) {
            var label = ("0" + i).slice(-2);
            hourCounts[label] = 0;
          }

          norm.forEach(function (ev) {
            var rawTime = ev.originalTime || ev.time;

            if (!rawTime) {
              return;
            }

            var d = new Date(rawTime);

            if (isNaN(d.getTime())) {
              return;
            }

            var hour = d.getHours();
            var hourLabel = ("0" + hour).slice(-2);

            hourCounts[hourLabel] = Number(hourCounts[hourLabel] || 0) + 1;
          });

          var hourChart = Object.keys(hourCounts)
            .sort(function (a, b) {
              return Number(a) - Number(b);
            })
            .map(function (hour) {
              return {
                time: hour,
                count: Number(hourCounts[hour] || 0)
              };
            });

          m.setProperty("/hourChart", hourChart);

          var userCounts = {};

          norm.forEach(function (ev) {
            var u = ev.user || "Unknown";

            if (!userCounts[u]) {
              userCounts[u] = 0;
            }

            userCounts[u]++;
          });

          var chartUsers = Object.keys(userCounts)
            .map(function (userKey) {
              return {
                user: userKey,
                count: userCounts[userKey]
              };
            })
            .sort(function (a, b) {
              return b.count - a.count;
            })
            .slice(0, 8);

          m.setProperty("/userChart", chartUsers);

          m.setProperty("/kpi", {
            high: norm.filter(function (x) {
              return x.risk === "High";
            }).length,
            medium: norm.filter(function (x) {
              return x.risk === "Medium";
            }).length,
            low: norm.filter(function (x) {
              return x.risk === "Low";
            }).length,
            loginCount: norm.filter(function (x) {
              return getRowGroup(x) === "LOGIN";
            }).length,
            tokenCount: norm.filter(function (x) {
              return getRowGroup(x) === "TOKEN";
            }).length,
            clientCount: norm.filter(function (x) {
              return getRowGroup(x) === "CLIENT";
            }).length,
            otherCount: norm.filter(function (x) {
              return getRowGroup(x) === "OTHER";
            }).length
          });

          m.setProperty("/typeKey", "ALL");
          m.setProperty("/emailFilter", "");
          m.setProperty("/ipFilter", "");
          m.setProperty("/widgetRiskFilter", "");
          m.setProperty("/widgetGroupFilter", "");

          this._applyFilters();
          this._configureRiskLineChart();
          this._connectLinePopover();
        }.bind(this))
        .catch(function (err) {
          console.error("[SEC] Load failed", err);

          MessageToast.show("Security events failed to load. Check backend/API.");

          var m = this.getView().getModel("security");

          m.setProperty("/all", []);
          m.setProperty("/rows", []);
          m.setProperty("/userChart", []);
          m.setProperty("/hourChart", []);
          m.setProperty("/firstAuditDate", "");
          m.setProperty("/lastAuditDate", "");
          m.setProperty("/coverageText", "");
          m.setProperty("/widgetRiskFilter", "");
          m.setProperty("/widgetGroupFilter", "");
          m.setProperty("/kpi", {
            high: 0,
            medium: 0,
            low: 0,
            loginCount: 0,
            tokenCount: 0,
            clientCount: 0,
            otherCount: 0
          });
        }.bind(this));
    },

    _bindWidgetFilters: function () {
      if (this._widgetFiltersBound) {
        return;
      }

      this._widgetFiltersBound = true;

      var mappings = [
        { id: "secKpiHigh", kind: "risk", value: "High" },
        { id: "secKpiMedium", kind: "risk", value: "Medium" },
        { id: "secKpiLow", kind: "risk", value: "Low" },
        { id: "secKpiAll", kind: "clear", value: "" },
        { id: "secMiniLogin", kind: "group", value: "LOGIN" },
        { id: "secMiniToken", kind: "group", value: "TOKEN" },
        { id: "secMiniClient", kind: "group", value: "CLIENT" },
        { id: "secMiniOther", kind: "group", value: "OTHER" }
      ];

      mappings.forEach(function (cfg) {
        var oControl = this.byId(cfg.id);

        if (!oControl) {
          return;
        }

        oControl.addStyleClass("clickableWidget");

        oControl.attachBrowserEvent("click", function () {
          this._onWidgetFilterPress(cfg.kind, cfg.value);
        }.bind(this));
      }.bind(this));
    },

    _onWidgetFilterPress: function (kind, value) {
      var m = this.getView().getModel("security");

      var currentRisk = m.getProperty("/widgetRiskFilter") || "";
      var currentGroup = m.getProperty("/widgetGroupFilter") || "";

      if (kind === "clear") {
        m.setProperty("/widgetRiskFilter", "");
        m.setProperty("/widgetGroupFilter", "");
        m.setProperty("/typeKey", "ALL");

        MessageToast.show("Filters cleared");
        this._applyFilters();
        return;
      }

      if (kind === "risk") {
        if (currentRisk === value) {
          m.setProperty("/widgetRiskFilter", "");
          MessageToast.show(value + " risk filter removed");
        } else {
          m.setProperty("/widgetRiskFilter", value);
          m.setProperty("/widgetGroupFilter", "");
          m.setProperty("/typeKey", "ALL");
          MessageToast.show("Filtered by " + value + " risk");
        }

        this._applyFilters();
        return;
      }

      if (kind === "group") {
        if (currentGroup === value) {
          m.setProperty("/widgetGroupFilter", "");
          MessageToast.show(value + " filter removed");
        } else {
          m.setProperty("/widgetGroupFilter", value);
          m.setProperty("/widgetRiskFilter", "");
          m.setProperty("/typeKey", "ALL");
          MessageToast.show("Filtered by " + value);
        }

        this._applyFilters();
      }
    },

    _updateWidgetActiveStyles: function () {
      var m = this.getView().getModel("security");

      if (!m) {
        return;
      }

      var activeRisk = m.getProperty("/widgetRiskFilter") || "";
      var activeGroup = m.getProperty("/widgetGroupFilter") || "";

      var allIds = [
        "secKpiHigh",
        "secKpiMedium",
        "secKpiLow",
        "secKpiAll",
        "secMiniLogin",
        "secMiniToken",
        "secMiniClient",
        "secMiniOther"
      ];

      allIds.forEach(function (id) {
        var oControl = this.byId(id);

        if (oControl) {
          oControl.removeStyleClass("filterWidgetActive");
        }
      }.bind(this));

      var activeId = "";

      if (activeRisk === "High") {
        activeId = "secKpiHigh";
      } else if (activeRisk === "Medium") {
        activeId = "secKpiMedium";
      } else if (activeRisk === "Low") {
        activeId = "secKpiLow";
      } else if (activeGroup === "LOGIN") {
        activeId = "secMiniLogin";
      } else if (activeGroup === "TOKEN") {
        activeId = "secMiniToken";
      } else if (activeGroup === "CLIENT") {
        activeId = "secMiniClient";
      } else if (activeGroup === "OTHER") {
        activeId = "secMiniOther";
      }

      if (activeId) {
        var oActive = this.byId(activeId);

        if (oActive) {
          oActive.addStyleClass("filterWidgetActive");
        }
      }
    },

    _applyFilters: function () {
      var m = this.getView().getModel("security");

      var all = m.getProperty("/all") || [];
      var typeKey = m.getProperty("/typeKey") || "ALL";
      var email = m.getProperty("/emailFilter") || "";
      var ip = m.getProperty("/ipFilter") || "";
      var widgetRiskFilter = m.getProperty("/widgetRiskFilter") || "";
      var widgetGroupFilter = m.getProperty("/widgetGroupFilter") || "";

      var rows = all.slice();

      if (widgetRiskFilter) {
        rows = rows.filter(function (r) {
          return r.risk === widgetRiskFilter;
        });
      }

      if (widgetGroupFilter) {
        rows = rows.filter(function (r) {
          return getRowGroup(r) === widgetGroupFilter;
        });
      }

      if (typeKey && typeKey !== "ALL") {
        rows = rows.filter(function (r) {
          return getRowGroup(r) === typeKey;
        });
      }

      if (email) {
        rows = rows.filter(function (r) {
          return (
            includesIC(r.user, email) ||
            includesIC(r.client, email) ||
            includesIC(r.origin, email) ||
            includesIC(r.message, email) ||
            includesIC(r.eventType, email) ||
            includesIC(r.risk, email)
          );
        });
      }

      if (ip) {
        rows = rows.filter(function (r) {
          return includesIC(r.ip, ip);
        });
      }

      m.setProperty("/rows", rows);
      this._updateWidgetActiveStyles();
    },

    onTypeChange: function (oEvent) {
      var item = oEvent.getParameter("item");
      var key = item ? item.getKey() : "ALL";

      var m = this.getView().getModel("security");

      m.setProperty("/typeKey", key);
      m.setProperty("/widgetRiskFilter", "");
      m.setProperty("/widgetGroupFilter", "");

      this._applyFilters();
    },

    onEmailChange: function (oEvent) {
      var val = (oEvent.getParameter("newValue") || "").trim();

      this.getView().getModel("security").setProperty("/emailFilter", val);
      this._applyFilters();
    },

    onIpChange: function (oEvent) {
      var val = (oEvent.getParameter("newValue") || "").trim();

      this.getView().getModel("security").setProperty("/ipFilter", val);
      this._applyFilters();
    },

    onUserPieSelect: function (oEvent) {
      var dataArr = oEvent.getParameter("data") || [];

      if (!dataArr.length || !dataArr[0].data) {
        return;
      }

      var data = dataArr[0].data;
      var user = data.User;
      var count = data.Events;

      MessageBox.information(
        user + "\n\nGenerated " + count + " IAM Security Events",
        {
          title: "User Event Count"
        }
      );
    },

    onExportSecurityPdf: function () {
      window.open(API_BASE + "/security/export/pdf", "_blank");
    },

    onExportVisibleSecurityExcel: function () {
      var m = this.getView().getModel("security");
      var rows = m.getProperty("/rows") || [];
      var count = rows.length;

      MessageToast.show("Exporting " + count + " filtered security rows");

      exportSecurityRowsToExcel(rows)
        .then(function () {
          MessageToast.show("Security Excel exported: " + count + " rows");
        })
        .catch(function (err) {
          console.error("[EXPORT FILTERED SECURITY] failed:", err);
          MessageToast.show("Security Excel export failed");
        });
    },

    onExportSecurityExcel: function () {
      this.onExportVisibleSecurityExcel();
    },

    onBack: function () {
      this.getOwnerComponent().getRouter().navTo("logs", {}, false);
    },

    onGoDataChanges: function () {
      this.getOwnerComponent().getRouter().navTo("datachanges", {}, false);
    },

    onGoLogs: function () {
      this.getOwnerComponent().getRouter().navTo("logs", {}, false);
    },

    onGoSystemHealth: function () {
      this.getOwnerComponent().getRouter().navTo("system", {}, false);
    },

    goRisk: function () {
      this.getOwnerComponent().getRouter().navTo("risk", {}, false);
    },

    goKmeans: function () {
      this.getOwnerComponent().getRouter().navTo("kmeans", {}, false);
    },

    onExit: function () {
      if (this._oRiskLinePopover) {
        this._oRiskLinePopover.destroy();
        this._oRiskLinePopover = null;
      }
    }

  });
});