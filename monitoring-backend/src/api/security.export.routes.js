import { Router } from "express";
import ExcelJS from "exceljs";
import axios from "axios";

const router = Router();

router.get("/security/export", async (req, res) => {

  try {

    // ✅ CALL SAME API USED BY SECURITY UI
    const { data } =
      await axios.get(
        "http://localhost:8090/security/events"
      );

    const logs = data.logs || [];

    const workbook =
      new ExcelJS.Workbook();

    const sheet =
      workbook.addWorksheet(
        "Security Events"
      );

    // ✅ TABLE COLUMNS
    sheet.columns = [
      { header:"Time",        key:"time",         width:20 },
      { header:"User",        key:"user",         width:30 },
      { header:"Risk",        key:"risk",         width:12 },
      { header:"Event Type",  key:"eventType",    width:25 },
      { header:"IP",          key:"ip",           width:15 },
      { header:"Client",      key:"client",       width:30 },
      { header:"Score",       key:"anomalyScore", width:12 }
    ];

    // ✅ FILL ROWS
    logs.forEach(l => {

      sheet.addRow({

        time: l.time || "",
        user: l.user || "",
        risk: l.risk || "",
        eventType: l.eventType || "",
        ip: l.ip || "",
        client: l.client || "",
        anomalyScore:
          l.anomalyScore
          ? Number(l.anomalyScore)
              .toFixed(3)
          : ""

      });

    });

    // ✅ RESPONSE HEADERS
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=Security_Events.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();

  }
  catch(err){

    console.error(
      "Security Excel export error:",
      err
    );

    res.status(500)
      .send("Security Export Failed");

  }

});

export default router;