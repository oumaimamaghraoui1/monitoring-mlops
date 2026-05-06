sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/export/Spreadsheet",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "pwc/monitoring/monitoringui/utils/TCodeClassificationHelper"
], function (Controller, JSONModel, Spreadsheet, MessageToast, MessageBox, TCodeClassificationHelper) {
  "use strict";

  const FAVORITES_KEY = "sapBasisFavorites";
  const RECENT_SEARCHES_KEY = "sapBasisRecentSearches";
  const MAX_RECENT_SEARCHES = 4;

  function includesIC(hay, needle) {
    if (!needle) {
      return true;
    }

    if (!hay) {
      return false;
    }

    return String(hay).toLowerCase().includes(String(needle).toLowerCase());
  }

  function getTcodeExportColumns() {
    return [
      { label: "Rank", property: "rank", width: 10 },
      { label: "T-Code", property: "tcode", width: 18 },
      { label: "Program", property: "program", width: 28 },
      { label: "Description", property: "desc", width: 60 },
      { label: "Domain", property: "domain", width: 18 },
      { label: "Module", property: "module", width: 18 },
      { label: "Cluster", property: "cluster", width: 28 },
      { label: "Similarity", property: "similarity", width: 18 },
      { label: "Favorite", property: "favoriteText", width: 14 }
    ];
  }

  function prepareExportRows(rows) {
    return (rows || []).map(function (row) {
      return {
        rank: row.rank || "",
        tcode: row.tcode || "",
        program: row.program || "",
        desc: row.desc || "",
        domain: row.domain || "",
        module: row.module || "",
        cluster: row.cluster || "",
        similarity: row.similarity !== undefined && row.similarity !== null ? row.similarity : "",
        favoriteText: row.isFavorite ? "Yes" : "No"
      };
    });
  }

  function exportRowsToExcel(rows, filePrefix) {
    const count = rows.length;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    const sheet = new Spreadsheet({
      workbook: {
        columns: getTcodeExportColumns()
      },
      dataSource: prepareExportRows(rows),
      fileName: filePrefix + "_FILTERED_" + count + "_rows_" + timestamp + ".xlsx"
    });

    return sheet.build().finally(function () {
      sheet.destroy();
    });
  }

  function escapeCsvValue(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  function downloadCsv(rows, filePrefix) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);

    const headers = [
      "Rank",
      "T-Code",
      "Program",
      "Description",
      "Domain",
      "Module",
      "Cluster",
      "Similarity",
      "Favorite"
    ];

    const lines = [headers.join(",")];

    (rows || []).forEach(function (row) {
      lines.push([
        escapeCsvValue(row.rank || ""),
        escapeCsvValue(row.tcode || ""),
        escapeCsvValue(row.program || ""),
        escapeCsvValue(row.desc || ""),
        escapeCsvValue(row.domain || ""),
        escapeCsvValue(row.module || ""),
        escapeCsvValue(row.cluster || ""),
        escapeCsvValue(row.similarity !== undefined && row.similarity !== null ? row.similarity : ""),
        escapeCsvValue(row.isFavorite ? "Yes" : "No")
      ].join(","));
    });

    const csvContent = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const fileName = filePrefix + "_" + timestamp + ".csv";

    const link = document.createElement("a");
    const url = window.URL.createObjectURL(blob);

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.URL.revokeObjectURL(url);
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.kmeans", {

    onInit: function () {
      const aFavorites = this._loadFavorites();
      const aRecentSearches = this._loadRecentSearches();

      this.getView().setModel(new JSONModel({
        all: [],
        rows: [],
        filterText: ""
      }), "recModel");

      this.getView().setModel(new JSONModel({
        favorites: aFavorites,
        showFavorites: true
      }), "favModel");

      this.getView().setModel(new JSONModel({
        recentSearches: aRecentSearches
      }), "searchModel");
    },

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
          body: JSON.stringify({
            tcode: tcode
          })
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error("HTTP " + response.status + ": " + text.slice(0, 200));
        }

        const payload = await response.json();
        const results = payload.results || [];
        const favorites = this._loadFavorites();

        const enriched = results.map(function (item) {
          const classified = TCodeClassificationHelper.enrichItem(item);

          return Object.assign({}, classified, {
            isFavorite: favorites.some(function (fav) {
              return fav.tcode === item.tcode;
            })
          });
        });

        const recModel = this.getView().getModel("recModel");
        recModel.setProperty("/all", enriched);
        recModel.setProperty("/filterText", "");

        this.getView().getModel("favModel").setProperty("/favorites", favorites);

        this._saveRecentSearch(tcode);
        this._applyResultFilter();

        if (!results.length) {
          MessageToast.show("No result found");
        } else {
          MessageToast.show(results.length + " recommendation results loaded");
        }

      } catch (e) {
        console.error("AI request failed", e);
        MessageToast.show("AI request failed");
      }
    },

    onQuickSuggestionPress: function (oEvent) {
      const sValue = oEvent.getSource().getText() || "";
      if (!sValue) {
        return;
      }

      this.byId("tcodeInput").setValue(sValue);
      this.onSearch();
    },

    onRecentSearchPress: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("searchModel");
      const sValue = oContext.getProperty("text");

      if (!sValue) {
        return;
      }

      this.byId("tcodeInput").setValue(sValue);
      this.onSearch();
    },

    onRemoveRecentSearch: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("searchModel");
      const sValue = oContext.getProperty("text");

      let aRecent = this._loadRecentSearches();

      aRecent = aRecent.filter(function (item) {
        return item.text !== sValue;
      });

      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(aRecent));
      this.getView().getModel("searchModel").setProperty("/recentSearches", aRecent);

      MessageToast.show("Removed: " + sValue);
    },

    onClearRecentSearches: function () {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
      this.getView().getModel("searchModel").setProperty("/recentSearches", []);
      MessageToast.show("Recent searches cleared");
    },

    _loadRecentSearches: function () {
      try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY)) || [];
      } catch (e) {
        return [];
      }
    },

    _saveRecentSearch: function (sSearchText) {
      if (!sSearchText) {
        return;
      }

      let aRecent = this._loadRecentSearches();

      aRecent = aRecent.filter(function (item) {
        return String(item.text).toLowerCase() !== String(sSearchText).toLowerCase();
      });

      aRecent.unshift({
        text: sSearchText
      });

      if (aRecent.length > MAX_RECENT_SEARCHES) {
        aRecent = aRecent.slice(0, MAX_RECENT_SEARCHES);
      }

      localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(aRecent));
      this.getView().getModel("searchModel").setProperty("/recentSearches", aRecent);
    },

    onResultFilterChange: function (oEvent) {
      const value =
        oEvent.getParameter("newValue") ||
        oEvent.getSource().getValue() ||
        "";

      this.getView().getModel("recModel").setProperty("/filterText", value.trim());
      this._applyResultFilter();
    },

    onClearResultFilter: function () {
      const recModel = this.getView().getModel("recModel");
      recModel.setProperty("/filterText", "");

      const sf = this.byId("sfTcodeResultFilter");
      if (sf) {
        sf.setValue("");
      }

      this._applyResultFilter();
    },

    _applyResultFilter: function () {
      const recModel = this.getView().getModel("recModel");

      const all = recModel.getProperty("/all") || [];
      const filterText = recModel.getProperty("/filterText") || "";

      let rows = all.slice();

      if (filterText) {
        rows = rows.filter(function (item) {
          return (
            includesIC(item.tcode, filterText) ||
            includesIC(item.program, filterText) ||
            includesIC(item.desc, filterText) ||
            includesIC(item.domain, filterText) ||
            includesIC(item.module, filterText) ||
            includesIC(item.cluster, filterText) ||
            includesIC(item.similarity, filterText) ||
            includesIC(item.rank, filterText)
          );
        });
      }

      recModel.setProperty("/rows", rows);
    },

    onCopyTcode: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("recModel");
      const sTcode = oContext.getProperty("tcode");
      this._copyText(sTcode);
    },

    onCopyFavoriteTcode: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("favModel");
      const sTcode = oContext.getProperty("tcode");
      this._copyText(sTcode);
    },

    _copyText: function (sText) {
      if (!sText) {
        MessageToast.show("Nothing to copy");
        return;
      }

      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(sText)
          .then(function () {
            MessageToast.show("Copied: " + sText);
          })
          .catch(function () {
            MessageToast.show("Copy failed");
          });
      } else {
        const el = document.createElement("textarea");
        el.value = sText;
        document.body.appendChild(el);
        el.select();

        try {
          document.execCommand("copy");
          MessageToast.show("Copied: " + sText);
        } catch (e) {
          MessageToast.show("Copy failed");
        }

        document.body.removeChild(el);
      }
    },

    onViewDetails: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("recModel");
      const oItem = oContext.getObject();

      const sMessage =
        "T-Code: " + (oItem.tcode || "") + "\n" +
        "Program: " + (oItem.program || "") + "\n" +
        "Description: " + (oItem.desc || "") + "\n" +
        "Domain: " + (oItem.domain || "") + "\n" +
        "Module: " + (oItem.module || "") + "\n" +
        "Cluster: " + (oItem.cluster || "") + "\n" +
        "Similarity: " + (oItem.similarity || "") + "\n" +
        "Classification Score: " + (oItem.clusterScore || 0);

      MessageBox.information(sMessage, {
        title: "Recommendation Details"
      });
    },

    onOpenDocumentation: function () {
      window.open(
        "https://help.sap.com/docs/SAP_S4HANA_CLOUD/a630d57fc5004c6383e7a81efee7a8bb/576fa8d8c74443b18c622068b6f55fa4.html?locale=en-US",
        "_blank"
      );
    },

    onToggleFavorite: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("recModel");
      const oItem = oContext.getObject();

      let aFavorites = this._loadFavorites();

      const bExists = aFavorites.some(function (fav) {
        return fav.tcode === oItem.tcode;
      });

      if (bExists) {
        aFavorites = aFavorites.filter(function (fav) {
          return fav.tcode !== oItem.tcode;
        });

        MessageToast.show("Removed from favorites: " + oItem.tcode);
      } else {
        aFavorites.push({
          rank: oItem.rank,
          tcode: oItem.tcode,
          program: oItem.program,
          desc: oItem.desc,
          domain: oItem.domain,
          module: oItem.module,
          cluster: oItem.cluster,
          similarity: oItem.similarity,
          isFavorite: true
        });

        MessageToast.show("Added to favorites: " + oItem.tcode);
      }

      this._saveFavorites(aFavorites);
      this.getView().getModel("favModel").setProperty("/favorites", aFavorites);

      this._refreshResultFavoriteState();
    },

    onRemoveFavorite: function (oEvent) {
      const oContext = oEvent.getSource().getBindingContext("favModel");
      const oItem = oContext.getObject();

      let aFavorites = this._loadFavorites();

      aFavorites = aFavorites.filter(function (fav) {
        return fav.tcode !== oItem.tcode;
      });

      this._saveFavorites(aFavorites);
      this.getView().getModel("favModel").setProperty("/favorites", aFavorites);

      this._refreshResultFavoriteState();

      MessageToast.show("Removed from favorites: " + oItem.tcode);
    },

    onToggleFavoritesPanel: function () {
      const oFavModel = this.getView().getModel("favModel");
      const bCurrent = oFavModel.getProperty("/showFavorites");
      oFavModel.setProperty("/showFavorites", !bCurrent);
    },

    _refreshResultFavoriteState: function () {
      const aFavorites = this._loadFavorites();

      const recModel = this.getView().getModel("recModel");
      const aAll = recModel.getProperty("/all") || [];

      const aUpdated = aAll.map(function (item) {
        return Object.assign({}, item, {
          isFavorite: aFavorites.some(function (fav) {
            return fav.tcode === item.tcode;
          })
        });
      });

      recModel.setProperty("/all", aUpdated);
      this._applyResultFilter();
    },

    _loadFavorites: function () {
      try {
        return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
      } catch (e) {
        return [];
      }
    },

    _saveFavorites: function (aFavorites) {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(aFavorites));
    },

    onExportFilteredResultsExcel: function () {
      const recModel = this.getView().getModel("recModel");
      const rows = recModel.getProperty("/rows") || [];
      const count = rows.length;

      MessageToast.show("Exporting " + count + " filtered T-Code rows");

      exportRowsToExcel(rows, "SAP_Basis_TCode_Recommendations")
        .then(function () {
          MessageToast.show("T-Code Excel exported: " + count + " rows");
        })
        .catch(function (err) {
          console.error("[EXPORT FILTERED T-CODES] failed:", err);
          MessageToast.show("T-Code Excel export failed");
        });
    },

    onExportFilteredResultsCsv: function () {
      const recModel = this.getView().getModel("recModel");
      const rows = recModel.getProperty("/rows") || [];
      const count = rows.length;

      if (!count) {
        MessageToast.show("No filtered results to export");
        return;
      }

      downloadCsv(rows, "SAP_Basis_TCode_Recommendations");
      MessageToast.show("CSV exported: " + count + " rows");
    },

    onExportFavoritesExcel: function () {
      const favModel = this.getView().getModel("favModel");
      const favorites = favModel.getProperty("/favorites") || [];
      const count = favorites.length;

      const rows = favorites.map(function (fav) {
        return Object.assign({}, fav, {
          isFavorite: true
        });
      });

      MessageToast.show("Exporting " + count + " favorite T-Codes");

      exportRowsToExcel(rows, "SAP_Basis_TCode_Favorites")
        .then(function () {
          MessageToast.show("Favorites Excel exported: " + count + " rows");
        })
        .catch(function (err) {
          console.error("[EXPORT FAVORITE T-CODES] failed:", err);
          MessageToast.show("Favorites Excel export failed");
        });
    }

  });
});