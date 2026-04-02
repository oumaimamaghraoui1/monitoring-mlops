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
        trendData: [],
        pieData: [],
        lastAuditDate: "-"
      });

      this.getView().setModel(this.model, "logs");

      this.loadData();

      this.interval = setInterval(() => {
        this.loadData();
      }, 10000);
    },

// ================= ISO WEEK =================

getISOWeek: function(date) {

  const d = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));

  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  const yearStart =
    new Date(Date.UTC(d.getUTCFullYear(),0,1));

  const week = Math.ceil(
    (((d - yearStart) / 86400000) + 1) / 7
  );

  return {
    year: d.getUTCFullYear(),
    week: week.toString().padStart(2,'0')
  };
},

// ================= LOAD DATA =================

loadData: function () {

const API_BASE =
"https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

fetch(`${API_BASE}/audit/scored`, { credentials: "include" })
.then(res => res.json())
.then(data => {

if (!data.logs || !data.logs.length)
  return;

const logs = data.logs;

// ================= LAST AUDIT DATE =================

const newestLog = logs.reduce((a,b) =>
  new Date(a.time) > new Date(b.time) ? a : b
);

this.model.setProperty(
  "/lastAuditDate",
  newestLog?.time || "-"
);

// ================= GROUP BY WEEK =================

const grouped = {};

logs.forEach(log => {

  if (!log.time || !log.risk)
    return;

  const d =
    new Date(log.time);

  const w =
    this.getISOWeek(d);

  const weekKey =
    `${w.year}-W${w.week}`;

  if (!grouped[weekKey]) {
    grouped[weekKey] = {
      week: weekKey,
      High: 0,
      Medium: 0,
      Low: 0,
      Normal: 0
    };
  }

  grouped[weekKey][log.risk]++;
});

// ✅ SORT WEEKS
// ✅ SORT WEEKS PROPERLY
const trendData =
Object.values(grouped)
.sort((a,b) => {

  const [ya, wa] = a.week.split("-W");
  const [yb, wb] = b.week.split("-W");

  return (ya*100 + wa*1) -
         (yb*100 + wb*1);
});

this.model.setProperty(
  "/trendData",
  trendData
);

// ================= DONUT = LAST WEEK % =================

const totalHigh =
logs.filter(l => l.risk === "High").length;

const totalMedium =
logs.filter(l => l.risk === "Medium").length;

const totalLow =
logs.filter(l => l.risk === "Low").length;

const totalNormal =
logs.filter(l => l.risk === "Normal").length;

const total =
totalHigh +
totalMedium +
totalLow +
totalNormal;

// ✅ DONUT = ALL LOGS COMPOSITION
this.model.setProperty("/pieData", [

{
risk: "High",
value: total ? (totalHigh / total)*100 : 0
},
{
risk: "Medium",
value: total ? (totalMedium / total)*100 : 0
},
{
risk: "Low",
value: total ? (totalLow / total)*100 : 0
},
{
risk: "Normal",
value: total ? (totalNormal / total)*100 : 0
}

]);


// ================= KPI =================

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

this.model.setProperty(
"/logs",
logs
);

this.getView()
.getModel("logs")
.refresh(true);

})
.catch(err =>
console.log("Risk fetch error:", err)
);
},
formatOperation: function(details){

if(!details)
return "Configuration Change";

try{

const obj =
typeof details === "string"
? JSON.parse(details)
: details;

// ✅ Role Collection
if(obj.rolecollection_name){
return `Role Collection "${obj.rolecollection_name}" ${obj.crudType || 'Updated'}`;
}

// ✅ Tenant parameter
if(obj["Resource Name"]){
return `Tenant Parameter "${obj["Resource Name"]}" ${obj.Action || 'Modified'}`;
}

// ✅ IAS DAS config
if(obj.origin){
return "Application Configuration Updated";
}

if(obj.tableName){
return `${obj.tableName} ${obj.crudType || ''}`;
}

}
catch(e){}

// already readable value
return details;

},
// ================= FILTER =================

onRiskFilter: function(oEvent) {

const risk =
oEvent.getSource()
.getCustomData()[0]
.getValue();

const table =
this.getView()
.byId("riskTable");

const binding =
table.getBinding("items");

if (!this.currentFilter) {
binding.filter([
new Filter(
"risk",
FilterOperator.EQ,
risk
)
]);
this.currentFilter = risk;
} else {
binding.filter([]);
this.currentFilter = null;
}
},

formatScore: function(score) {
return score ? score.toFixed(3) : "";
},

onGoSecurity: function () {
this.getOwnerComponent()
.getRouter()
.navTo("security");
},

onGoDataChanges() {
this.getOwnerComponent()
.getRouter()
.navTo("datachanges");
},

onGoSystemHealth() {
this.getOwnerComponent()
.getRouter()
.navTo("system");
},

onExit: function () {
clearInterval(this.interval);
},
onExportExcel: function(){

const API_BASE =
"https://port8090-workspaces-ws-dl8fm.eu10.applicationstudio.cloud.sap";

window.open(
 `${API_BASE}/audit/risk/export`,
 "_blank"
);

}

});


});

