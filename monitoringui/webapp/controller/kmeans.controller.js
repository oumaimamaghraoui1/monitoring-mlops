sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/export/Spreadsheet",
  "sap/m/MessageToast"
], function (Controller, JSONModel, Spreadsheet, MessageToast) {
  "use strict";

  const FAVORITES_KEY = "sapBasisFavorites";

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
      {
        label: "Rank",
        property: "rank",
        width: 10
      },
      {
        label: "T-Code",
        property: "tcode",
        width: 18
      },
      {
        label: "Program",
        property: "program",
        width: 28
      },
      {
        label: "Description",
        property: "desc",
        width: 60
      },
      {
        label: "Cluster",
        property: "cluster",
        width: 18
      },
      {
        label: "Similarity",
        property: "similarity",
        width: 18
      },
      {
        label: "Favorite",
        property: "favoriteText",
        width: 14
      }
    ];
  }

  function prepareExportRows(rows) {
    return (rows || []).map(function (row) {
      return {
        rank: row.rank || "",
        tcode: row.tcode || "",
        program: row.program || "",
        desc: row.desc || "",
        cluster: row.cluster || "",
        similarity:
          row.similarity !== undefined && row.similarity !== null
            ? row.similarity
            : "",
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

    return sheet.build()
      .finally(function () {
        sheet.destroy();
      });
  }

  return Controller.extend("pwc.monitoring.monitoringui.controller.kmeans", {

    onInit: function () {
      const aFavorites = this._loadFavorites();

      this.getView().setModel(new JSONModel({
        all: [],
        rows: [],
        filterText: ""
      }), "recModel");

      this.getView().setModel(new JSONModel({
        favorites: aFavorites,
        showFavorites: true
      }), "favModel");
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
          return Object.assign({}, item, {
            isFavorite: favorites.some(function (fav) {
              return fav.tcode === item.tcode;
            })
          });
        });

        const recModel = this.getView().getModel("recModel");

        recModel.setProperty("/all", enriched);
        recModel.setProperty("/filterText", "");

        this.getView().getModel("favModel").setProperty("/favorites", favorites);

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

    // =====================================================
    // Result filtering
    // =====================================================

    onResultFilterChange: function (oEvent) {
      const value =
        oEvent.getParameter("newValue") ||
        oEvent.getSource().getValue() ||
        "";

      this.getView()
        .getModel("recModel")
        .setProperty("/filterText", value.trim());

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
            includesIC(item.cluster, filterText) ||
            includesIC(item.similarity, filterText) ||
            includesIC(item.rank, filterText)
          );
        });
      }

      recModel.setProperty("/rows", rows);
    },

    // =====================================================
    // Copy
    // =====================================================

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

    // =====================================================
    // Favorites
    // =====================================================

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

    // =====================================================
    // Excel exports
    // =====================================================

    onExportFilteredResultsExcel: function () {
      const recModel = this.getView().getModel("recModel");
      const rows = recModel.getProperty("/rows") || [];
      const count = rows.length;

      MessageToast.show("Exporting " + count + " filtered T-Code rows");

      console.log("[EXPORT FILTERED T-CODES] rows count:", count);
      console.log("[EXPORT FILTERED T-CODES] rows:", rows);

      exportRowsToExcel(rows, "SAP_Basis_TCode_Recommendations")
        .then(function () {
          MessageToast.show("T-Code Excel exported: " + count + " rows");
        })
        .catch(function (err) {
          console.error("[EXPORT FILTERED T-CODES] failed:", err);
          MessageToast.show("T-Code Excel export failed");
        });
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

      console.log("[EXPORT FAVORITE T-CODES] rows count:", count);
      console.log("[EXPORT FAVORITE T-CODES] rows:", rows);

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