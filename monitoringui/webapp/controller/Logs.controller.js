sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  var EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  // =========================================================
  // BASIC HELPERS
  // =========================================================

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

  function includesIgnoreCase(hay, needle) {
    if (!needle) {
      return true;
    }
    if (!hay) {
      return false;
    }
    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  function firstEmail(value) {
    if (!value) {
      return "";
    }
    var m = String(value).match(EMAIL_RE);
    return m ? m[0].toLowerCase() : "";
  }

  function safeParseMessage(row) {
    try {
      if (row && row.raw && row.raw.message) {
        return JSON.parse(row.raw.message);
      }
    } catch (e) {
      // ignore malformed payloads
    }
    return null;
  }

  function getActorRaw(row) {
    return (
      (row && row.actor) ||
      (row && row.raw && row.raw.user) ||
      "Unknown"
    );
  }

  function cleanActorDisplay(value) {
    if (!value) {
      return "Unknown";
    }

    var s = String(value).trim();

    // 1) if email exists anywhere, show only the email
    var email = firstEmail(s);
    if (email) {
      return email;
    }

    // 2) user/sap.default/foo@bar.com -> foo@bar.com
    if (s.indexOf("user/") === 0) {
      return s.split("/").pop();
    }

    // 3) sb-xxx|portal-cf-service!b3664 -> portal-cf-service
    if (s.indexOf("|") > -1) {
      var afterPipe = s.split("|")[1] || s;
      return afterPipe.split("!")[0] || afterPipe;
    }

    // 4) sb-das-application!b188376 -> das-application
    if (s.indexOf("sb-") === 0 && s.indexOf("!") > -1) {
      return s.replace("sb-", "").split("!")[0];
    }

    return s;
  }

  function cleanTargetDisplay(value) {
    if (!value) {
      return "Unknown";
    }

    var s = String(value).trim();

    if (s === "Unknown") {
      return "Unknown";
    }

    var email = firstEmail(s);
    if (email) {
      return email;
    }

    if (s.indexOf("user/") === 0) {
      return s.split("/").pop();
    }

    return s;
  }

  function isHumanActor(actorRaw) {
    return (
      typeof actorRaw === "string" &&
      (
        actorRaw.indexOf("user/") === 0 ||
        actorRaw.indexOf("@") > -1
      )
    );
  }

  function isHumanEvent(row) {
    var actorRaw = getActorRaw(row);

    return (
      !!(row && row.isHuman === true) ||
      isHumanActor(actorRaw)
    );
  }

  function normalizeCrud(value, fallback) {
    var v = String(value || fallback || "OTHER").trim().toUpperCase();

    if (v === "CREATE" || v === "UPDATE" || v === "DELETE") {
      return v;
    }

    return "OTHER";
  }

  function extractCrudType(row, parsed) {
    var crud = "";
    var attrs = parsed && parsed.attributes ? parsed.attributes : [];
    var i;

    // 1) best source: object.id.crudType
    crud = parsed &&
      parsed.object &&
      parsed.object.id &&
      parsed.object.id.crudType;

    if (crud) {
      return normalizeCrud(crud, row && row.action);
    }

    // 2) operationType
    crud = parsed &&
      parsed.object &&
      parsed.object.id &&
      parsed.object.id.operationType;

    if (crud) {
      return normalizeCrud(crud, row && row.action);
    }

    // 3) operation in attributes
    for (i = 0; i < attrs.length; i++) {
      if (attrs[i] && attrs[i].name === "operation") {
        crud = attrs[i].new || attrs[i].old;
        if (crud) {
          return normalizeCrud(crud, row && row.action);
        }
      }
    }

    // 4) generic fallback
    crud = parsed && parsed.crudType;
    if (crud) {
      return normalizeCrud(crud, row && row.action);
    }

    return normalizeCrud(row && row.action, "OTHER");
  }

  // =========================================================
  // SCIM / ROLE HELPERS
  // =========================================================

  function extractScimUserInfo(parsed) {
    if (!parsed || !parsed.attributes || !Array.isArray(parsed.attributes)) {
      return {
        email: "",
        name: ""
      };
    }

    var i, payload, obj, emails, first, nameObj, name, email;
    for (i = 0; i < parsed.attributes.length; i++) {
      if (!parsed.attributes[i] || parsed.attributes[i].name !== "complete") {
        continue;
      }

      var payloads = [parsed.attributes[i].new, parsed.attributes[i].old];

      for (var j = 0; j < payloads.length; j++) {
        payload = payloads[j];
        if (!payload) {
          continue;
        }

        try {
          obj = JSON.parse(payload);
        } catch (e) {
          obj = null;
        }

        if (!obj || typeof obj !== "object") {
          continue;
        }

        email = "";
        emails = obj.emails || [];

        if (Array.isArray(emails)) {
          first = null;
          for (var k = 0; k < emails.length; k++) {
            if (emails[k] && emails[k].value) {
              first = emails[k];
              break;
            }
          }
          if (first && first.value) {
            email = String(first.value).toLowerCase();
          }
        }

        if (!email && obj.externalId) {
          email = firstEmail(obj.externalId);
        }

        if (!email) {
          email = firstEmail(payload);
        }

        nameObj = obj.name || {};
        name =
          nameObj.formatted ||
          [nameObj.givenName, nameObj.familyName].filter(Boolean).join(" ");

        if (email || name) {
          return {
            email: email || "",
            name: name || ""
          };
        }
      }
    }

    return {
      email: "",
      name: ""
    };
  }

  function extractRoleName(row) {
    if (!row) {
      return "";
    }

    // strict source: rolecollection_name only
    try {
      var parsed = JSON.parse((row.raw && row.raw.message) || "{}");
      var role = parsed &&
        parsed.object &&
        parsed.object.id &&
        parsed.object.id.rolecollection_name;

      if (role) {
        return String(role).trim();
      }
    } catch (e) {
      // ignore
    }

    // safe fallback only if row is already Role Assignment with explicit Assigned role:
    if (row.details && String(row.details).indexOf("Assigned role: ") === 0) {
      return String(row.details).replace("Assigned role: ", "").trim();
    }

    if (
      row.objectType === "Role Assignment" &&
      row.target &&
      row.target !== "Unknown" &&
      row.target !== row.actor
    ) {
      return String(row.target).trim();
    }

    return "";
  }

  function isExplicitRoleAssignment(parsed) {
    var tableName =
      parsed &&
      parsed.object &&
      parsed.object.id &&
      parsed.object.id.tableName;

    var objectType =
      parsed &&
      parsed.object &&
      parsed.object.type;

    var roleName =
      parsed &&
      parsed.object &&
      parsed.object.id &&
      parsed.object.id.rolecollection_name;

    return (
      tableName === "xs_rolecollection2user" ||
      objectType === "xs_rolecollection2user" ||
      !!roleName
    );
  }

  function buildGenericDetails(parsed, currentDetails) {
    var d = String(currentDetails || "").trim();

    // do not preserve polluted legacy strings
    if (
      d &&
      d.indexOf("Assigned role: ") !== 0 &&
      d.indexOf("User identity updated") !== 0
    ) {
      return d;
    }

    var objectNode = parsed && parsed.object ? parsed.object : {};
    var objectId = objectNode.id || {};
    var tableName = objectId.tableName || "";
    var objectTypeRaw = objectNode.type || "";

    if (objectTypeRaw === "Deployment") {
      return "Deployment";
    }
    if (objectTypeRaw === "Undeployment") {
      return "Undeployment";
    }
    if (objectTypeRaw === "Redeployment") {
      return "Redeployment";
    }

    if (tableName) {
      return "Configuration updated (" + tableName + ")";
    }

    if (objectTypeRaw) {
      return "Configuration updated (" + objectTypeRaw + ")";
    }

    return "Configuration updated";
  }

  // =========================================================
  // DISPLAY NORMALIZATION
  // =========================================================

  function deriveDisplayRow(row) {
    var parsed = safeParseMessage(row);

    var actorRaw = getActorRaw(row);
    var actor = cleanActorDisplay(actorRaw);

    var action = extractCrudType(row, parsed);
    var target = (row && row.target) || "Unknown";
    var objectType = (row && row.objectType) || "Configuration Change";
    var details = (row && row.details) || "";

    var objType = parsed && parsed.object && parsed.object.type;
    var objId = parsed && parsed.object && parsed.object.id ? parsed.object.id : {};
    var roleName = objId.rolecollection_name || "";

    var human = isHumanEvent(row);

    // 1) SCIM USER UPDATE MUST WIN FIRST
    if (objType === "scim user") {
      var scim = extractScimUserInfo(parsed);

      objectType = "User Profile Update";
      target = cleanTargetDisplay(
        scim.email ||
        (target !== "Unknown" ? target : actor)
      );

      details =
        scim.name && scim.email
          ? "User identity updated: " + scim.name + " (" + scim.email + ")"
          : scim.email
          ? "User identity updated: " + scim.email
          : details || "User identity updated";

      human = true;
    }

    // 2) REAL ROLE ASSIGNMENT ONLY
    else if (isExplicitRoleAssignment(parsed)) {
      objectType = "Role Assignment";
      target = cleanTargetDisplay(roleName || extractRoleName(row) || target || "Role");
      details = roleName
        ? "Assigned role: " + roleName
        : "Role assignment";
      human = true;
    }

    // 3) GENERIC CONFIG CHANGE
    else {
      objectType = "Configuration Change";
      details = buildGenericDetails(parsed, details);
      target = cleanTargetDisplay(target);

      // generic human only if actor is human-like
      human = isHumanActor(actorRaw);
    }

    return {
      uuid: row.uuid,
      time: formatTime(row.time),
      actor: actor || "Unknown",
      target: target || "Unknown",
      objectType: objectType || "Configuration Change",
      action: action || "OTHER",
      details: details || "",
      isHuman: !!human,
      raw: row.raw || null,
      risk: row.risk || "",
      riskState: row.riskState || "",
      anomalyScore:
        row.anomalyScore !== undefined && row.anomalyScore !== null
          ? row.anomalyScore
          : ""
    };
  }

  // =========================================================
  // KPI
  // =========================================================

  function computeLogKpis(rows) {
    var humanRows = rows.filter(function (r) {
      return isHumanEvent(r);
    });

    var roleRows = humanRows.filter(function (r) {
      return isExplicitRoleAssignment(safeParseMessage(r));
    });

    var roleCounts = {};
    var actorCounts = {};
    var crudSummary = {
      CREATE: 0,
      UPDATE: 0,
      DELETE: 0,
      OTHER: 0
    };

    humanRows.forEach(function (r) {
      var parsed = safeParseMessage(r);
      var crud = extractCrudType(r, parsed);

      if (crudSummary[crud] !== undefined) {
        crudSummary[crud] += 1;
      } else {
        crudSummary.OTHER += 1;
      }
    });

    roleRows.forEach(function (r) {
      var role = extractRoleName(r);
      var actor = cleanActorDisplay(r.actor || "Unknown");

      if (!role) {
        return;
      }

      roleCounts[role] = (roleCounts[role] || 0) + 1;
      actorCounts[actor] = (actorCounts[actor] || 0) + 1;
    });

    var sortedRoles = Object.keys(roleCounts)
      .map(function (key) {
        return { name: key, count: roleCounts[key] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.name.localeCompare(b.name);
      });

    var sortedActors = Object.keys(actorCounts)
      .map(function (key) {
        return { name: key, count: actorCounts[key] };
      })
      .sort(function (a, b) {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.name.localeCompare(b.name);
      });

    var topRole = sortedRoles.length ? sortedRoles[0] : null;
    var topActor = sortedActors.length ? sortedActors[0] : null;

    return {
      totalHumanChanges: humanRows.length,
      totalRoleAssignments: roleRows.length,
      topAssignedRole: topRole ? topRole.name : "N/A",
      topAssignedRoleCount: topRole ? topRole.count : 0,
      topGrantingActor: topActor ? topActor.name : "N/A",
      topGrantingActorCount: topActor ? topActor.count : 0,
      top10Roles: sortedRoles.slice(0, 10),
      crudSummary: crudSummary
    };
  }

  // =========================================================
  // CONTROLLER
  // =========================================================

  return Controller.extend("pwc.monitoring.monitoringui.controller.Logs", {

    onInit: function () {
      var m = new JSONModel({
        all: [],
        human: [],
        system: [],
        hideUnknown: true,
        humanFilter: "ALL",
        systemFilter: "ALL",
        humanEmail: "",
        systemEmail: "",
        kpis: {
          totalHumanChanges: 0,
          totalRoleAssignments: 0,
          topAssignedRole: "N/A",
          topAssignedRoleCount: 0,
          topGrantingActor: "N/A",
          topGrantingActorCount: 0,
          top10Roles: [],
          crudSummary: {
            CREATE: 0,
            UPDATE: 0,
            DELETE: 0,
            OTHER: 0
          }
        }
      });

      this.getView().setModel(m, "logs");
      this.onRefresh();
    },

    onAfterRendering: function () {
      this._configureTopRolesChart();
    },

    _configureTopRolesChart: function () {
      var oChart = this.byId("topRolesChart");
      if (!oChart) {
        return;
      }

      var aColors = [
        "#2F6497",
        "#3A7CA5",
        "#4C8CBF",
        "#5BA2C7",
        "#6D9FA3",
        "#7F9192",
        "#8FA1B3",
        "#A3B6C2",
        "#C8D4DC",
        "#E3E8EC"
      ];

      var oModel = this.getView().getModel("logs");
      var aTopRoles = (oModel && oModel.getProperty("/kpis/top10Roles")) || [];

      var aRules = aTopRoles.map(function (oRole, i) {
        return {
          dataContext: {
            Role: oRole.name
          },
          properties: {
            color: aColors[i % aColors.length]
          }
        };
      });

      oChart.setVizProperties({
        title: {
          visible: true,
          text: "Top Assigned Role Collections in IAS Tenant"
        },

        legend: {
          visible: false
        },

        plotArea: {
          dataPointStyle: {
            rules: aRules,
            others: {
              color: "#DDE6ED"
            }
          },

          gap: {
            barSpacing: 0.05
          },

          dataLabel: {
            visible: true,
            position: "outsideEnd",
            formatString: "0"
          }
        },

        valueAxis: {
          visible: false
        },

        valueAxis2: {
          visible: false
        },

        categoryAxis: {
          title: {
            visible: false
          }
        },

        interaction: {
          selectability: {
            mode: "NONE"
          }
        }
      });
    },

    onRefresh: function () {
      var API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

      fetch(API_BASE + "/audit/full", { credentials: "include" })
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (text) {
              throw new Error("HTTP " + r.status + " " + r.statusText + ": " + text.slice(0, 200));
            });
          }
          return r.json();
        })
        .then(function (json) {
          var rows = Array.isArray(json.logs) ? json.logs : [];

          var normalized = rows.map(function (x) {
            return deriveDisplayRow(x);
          });

          normalized.sort(function (a, b) {
            return new Date(b.time) - new Date(a.time);
          });

          var model = this.getView().getModel("logs");
          model.setProperty("/all", normalized);

          var kpis = computeLogKpis(normalized);
          model.setProperty("/kpis", kpis);

          model.setProperty("/humanFilter", "ALL");
          model.setProperty("/systemFilter", "ALL");

          var humanSeg = this.byId("sbHumanFilter");
          var systemSeg = this.byId("sbSystemFilter");

          if (humanSeg) {
            humanSeg.setSelectedKey("ALL");
          }
          if (systemSeg) {
            systemSeg.setSelectedKey("ALL");
          }

          this._applyFilters();

          // apply chart styling after data is present
          this._configureTopRolesChart();
          setTimeout(function () {
            this._configureTopRolesChart();
          }.bind(this), 0);

          console.log("[UI] Total rows:", normalized.length);
          console.log("[KPI] Computed KPIs:", kpis);
        }.bind(this))
        .catch(function (err) {
          console.error("[UI] Failed to load logs:", err);
        });
    },

    onHumanFilterChange: function (e) {
      var key = e.getParameter("item").getKey();
      var m = this.getView().getModel("logs");
      m.setProperty("/humanFilter", key);
      this._applyFilters();
    },

    onHumanEmailChange: function (e) {
      var val = e.getParameter("newValue") || e.getSource().getValue() || "";
      var m = this.getView().getModel("logs");
      m.setProperty("/humanEmail", val.trim());
      this._applyFilters();
    },

    onSystemFilterChange: function (e) {
      var key = e.getParameter("item").getKey();
      var m = this.getView().getModel("logs");
      m.setProperty("/systemFilter", key);
      this._applyFilters();
    },

    onSystemEmailChange: function (e) {
      var val = e.getParameter("newValue") || e.getSource().getValue() || "";
      var m = this.getView().getModel("logs");
      m.setProperty("/systemEmail", val.trim());
      this._applyFilters();
    },

    onToggleUnknown: function () {
      this._applyFilters();
    },

    onGoSecurity: function () {
      this.getOwnerComponent().getRouter().navTo("security", {}, false);
    },

    onExportLogsExcel: function () {
      var API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";
      window.open(API_BASE + "/audit/export/excel", "_blank");
    },

    onExportLogsPdf: function () {
      var API_BASE = "https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";
      window.open(API_BASE + "/audit/export/pdf", "_blank");
    },

    onGoDataChanges: function () {
      this.getOwnerComponent().getRouter().navTo("datachanges", {}, false);
    },

    onGoSystemHealth: function () {
      this.getOwnerComponent().getRouter().navTo("system", {}, false);
    },

    onGoAnomalies: function () {
      this.getOwnerComponent().getRouter().navTo("anomalies", {}, false);
    },

    goRisk: function () {
      this.getOwnerComponent().getRouter().navTo("risk", {}, false);
    },

    goKmeans: function () {
      this.getOwnerComponent().getRouter().navTo("kmeans", {}, false);
    },

    _applyFilters: function () {
      var m = this.getView().getModel("logs");
      var all = m.getProperty("/all") || [];
      var hideUnknown = m.getProperty("/hideUnknown");

      var hType = m.getProperty("/humanFilter");
      var hEmail = m.getProperty("/humanEmail");

      var human = all.filter(function (x) {
        return isHumanEvent(x);
      });

      if (hideUnknown) {
        human = human.filter(function (x) {
          return x.actor && x.actor !== "Unknown";
        });
      }

      if (hType === "Role Assignment") {
        human = human.filter(function (x) {
          return x.objectType === "Role Assignment";
        });
      } else if (hType === "Configuration Change") {
        human = human.filter(function (x) {
          return x.objectType === "Configuration Change";
        });
      }

      if (hEmail) {
        human = human.filter(function (x) {
          return (
            includesIgnoreCase(x.actor, hEmail) ||
            includesIgnoreCase(x.target, hEmail) ||
            includesIgnoreCase(x.details, hEmail)
          );
        });
      }

      var sType = m.getProperty("/systemFilter");
      var sEmail = m.getProperty("/systemEmail");

      var system = all.filter(function (x) {
        return !isHumanEvent(x);
      });

      if (sType !== "ALL") {
        system = system.filter(function (x) {
          return x.objectType === sType;
        });
      }

      if (sEmail) {
        system = system.filter(function (x) {
          return (
            includesIgnoreCase(x.actor, sEmail) ||
            includesIgnoreCase(x.target, sEmail) ||
            includesIgnoreCase(x.details, sEmail)
          );
        });
      }

      m.setProperty("/human", human);
      m.setProperty("/system", system);
    }

  });
});