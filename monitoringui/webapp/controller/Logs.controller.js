sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

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

  function getActor(row) {
    return (
      (row && row.actor) ||
      (row && row.raw && row.raw.user) ||
      "Unknown"
    );
  }

  function isHumanEvent(row) {
    var actor = getActor(row);

    return (
      !!(row && row.isHuman === true) ||
      (typeof actor === "string" && actor.indexOf("user/") === 0) ||
      (typeof actor === "string" && actor.indexOf("@") > -1)
    );
  }

  function normalizeCrud(value, fallback) {
    var v = (value || fallback || "UPDATE");
    v = String(v).trim().toUpperCase();

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

    // 2) sometimes operation appears in attributes
    for (i = 0; i < attrs.length; i++) {
      if (attrs[i] && attrs[i].name === "operation") {
        crud = attrs[i].new || attrs[i].old;
        if (crud) {
          return normalizeCrud(crud, row && row.action);
        }
      }
    }

    // 3) generic fallbacks
    crud = parsed && parsed.crudType;
    if (crud) {
      return normalizeCrud(crud, row && row.action);
    }

    return normalizeCrud(row && row.action, "UPDATE");
  }

  function extractRoleName(row) {
    if (!row) {
      return "";
    }

    // 1) Best source: rolecollection_name from raw audit payload
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

    // 2) Fallback: details column
    if (row.details) {
      var d = String(row.details).trim();

      if (d.indexOf("Assigned role: ") === 0) {
        return d.replace("Assigned role: ", "").trim();
      }

      var denyList = [
        "User identity updated",
        "Technical configuration",
        "Technical event",
        "Role collection assigned or removed",
        "Configuration Change",
        "Redeployment",
        "Deployment",
        "Update",
        "Updated",
        "Unknown"
      ];

      if (d && denyList.indexOf(d) === -1) {
        return d;
      }
    }

    // 3) Fallback: target if meaningful
    if (
      row.target &&
      row.target !== "Unknown" &&
      row.target !== row.actor
    ) {
      return String(row.target).trim();
    }

    return "";
  }

  function computeLogKpis(rows) {
    var humanRows = rows.filter(function (r) {
      return isHumanEvent(r);
    });

    var roleRows = humanRows.filter(function (r) {
      try {
        var parsed = JSON.parse((r.raw && r.raw.message) || "{}");
        var tableName =
          parsed &&
          parsed.object &&
          parsed.object.id &&
          parsed.object.id.tableName;

        var objectType =
          parsed &&
          parsed.object &&
          parsed.object.type;

        if (tableName === "xs_rolecollection2user" || objectType === "xs_rolecollection2user") {
          return true;
        }
      } catch (e) {
        // ignore
      }

      return !!extractRoleName(r);
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

      if (!crudSummary[crud] && crudSummary[crud] !== 0) {
        crudSummary.OTHER += 1;
      } else {
        crudSummary[crud] += 1;
      }
    });

    roleRows.forEach(function (r) {
      var role = extractRoleName(r);
      var actor = r.actor || "Unknown";

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
function isRoleAssignmentRow(row) {
  // reuse the same logic as KPI
  return !!extractRoleName(row);
}


  function deriveDisplayRow(row) {
    var parsed = safeParseMessage(row);

    var actor = getActor(row);
    var action = extractCrudType(row, parsed);
    var target = (row && row.target) || "Unknown";
    var objectType = (row && row.objectType) || "Configuration Change";
    var details = (row && row.details) || "";

    var objType = parsed && parsed.object && parsed.object.type;
    var objId = parsed && parsed.object && parsed.object.id ? parsed.object.id : {};
    var tableName = objId.tableName || "";
    var roleName = objId.rolecollection_name || "";

    var human = isHumanEvent(row);

    // 1) Explicit role assignment events
    // ✅ Role assignments (align with KPI logic)
    if (isRoleAssignmentRow(row)) {
      objectType = "Role Assignment";
      target = roleName || extractRoleName(row) || target || "Role";
      details = extractRoleName(row)
        ? ("Assigned role: " + extractRoleName(row))
        : "Role assignment";
      human = true;
    }
    // 2) User profile updates only when really SCIM user updates
    else if (objType === "scim user") {
      objectType = "User Profile Update";
      target = target && target !== "Unknown" ? target : actor;
      details = details || "User identity updated";
      human = true;
    } else {
      objectType = objectType || "Configuration Change";
      details = details || "";
    }
    
    return {
      uuid: row.uuid,
      time: formatTime(row.time),
      actor: actor || "Unknown",
      target: target || "Unknown",
      objectType: objectType || "Configuration Change",
      action: action || "UPDATE",
      details: details || "",
      isHuman: !!human,
      raw: row.raw || null
    };
  }

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
          this._configureTopRolesChart();

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

      if (hType !== "ALL") {
        human = human.filter(function (x) {
          return x.objectType === hType;
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