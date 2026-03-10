/*global QUnit*/

sap.ui.define([
	"pwc/monitoring/monitoringui/controller/monitoringui.controller"
], function (Controller) {
	"use strict";

	QUnit.module("monitoringui Controller");

	QUnit.test("I should test the monitoringui controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
