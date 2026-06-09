import { Router } from "express";
import ExcelJS from "exceljs";
import axios from "axios";

const router = Router();

router.get("/risk/export",async(req,res)=>{

try{

// ==============================================
// CALL SAME API USED BY UI
// ==============================================

const API_BASE =
  process.env.INTERNAL_API_BASE ||
  `http://127.0.0.1:${process.env.PORT || 8090}`;

console.log("[RISK EXPORT] API_BASE =", API_BASE);

const AUDIT_SCORED_URL = `${API_BASE}/audit/scored`;

const {data} =
await axios.get(API);

const logs = data.logs || [];

// ==============================================
// CREATE EXCEL
// ==============================================

const workbook =
new ExcelJS.Workbook();

const sheet =
workbook.addWorksheet(
"AI Risk Monitoring"
);

sheet.columns=[

{
header:"Role / Operation",
key:"details",
width:50
},
{
header:"Score",
key:"anomalyScore",
width:15
},
{
header:"Risk",
key:"risk",
width:15
}

];

// ==============================================
// ADD ROWS
// ==============================================

logs.forEach(l=>{

sheet.addRow({

 details:
   l.details ||
   "Configuration Change",

 anomalyScore:
   l.anomalyScore
   ? Number(l.anomalyScore)
     .toFixed(3)
   : "",

 risk:
   l.risk || ""

});

});

// ==============================================
// RESPONSE
// ==============================================

res.setHeader(
"Content-Type",
"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
);

res.setHeader(
"Content-Disposition",
"attachment; filename=AI_Risk.xlsx"
);

await workbook.xlsx.write(res);
res.end();

}
catch(err){

console.error(
"Excel export error:",
err
);

res.status(500)
.send("Export failed");

}

});

export default router;
