sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageToast) {
  "use strict";

  const FAVORITES_KEY = "sapBasisFavorites";

  return Controller.extend("pwc.monitoring.monitoringui.controller.kmeans", {
    onInit: function () {
      const aFavorites = this._loadFavorites();

      this.getView().setModel(new JSONModel([]), "recModel");
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
          body: JSON.stringify({ tcode })
        });

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

        this.getView().getModel("recModel").setData(enriched);
        this.getView().getModel("favModel").setProperty("/favorites", favorites);

        if (!results.length) {
          MessageToast.show("No result found");
        }

      } catch (e) {
        console.error("AI request failed", e);
        MessageToast.show("AI request failed");
      }
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
          similarity: oItem.similarity
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
      const aResults = this.getView().getModel("recModel").getData() || [];

      const aUpdated = aResults.map(function (item) {
        return Object.assign({}, item, {
          isFavorite: aFavorites.some(function (fav) {
            return fav.tcode === item.tcode;
          })
        });
      });

      this.getView().getModel("recModel").setData(aUpdated);
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
    }
  });
});