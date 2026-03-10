sap.ui.define([
  "sap/ui/core/format/DateFormat"
], function (DateFormat) {
  "use strict";

  // Basic email detector
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

  function pickEmail(s) {
    if (!s) return null;
    const str = String(s);
    const m = str.match(EMAIL_RE);
    return m ? m[0] : null;
  }

  function normalizeActor(actorLike) {
    // Prefer a true email if present
    const email = pickEmail(actorLike);
    if (email) return email;

    if (!actorLike) return "Unknown";
    const s = String(actorLike);

    // If format is "prefix/prefix/email@domain", take last segment and re-check
    const tail = s.includes("/") ? s.split("/").pop() : s;
    const tailEmail = pickEmail(tail);
    if (tailEmail) return tailEmail;

    // strip any pipe-separated info, take last part if that looks like an email
    const tail2 = tail.includes("|") ? tail.split("|").pop() : tail;
    const tail2Email = pickEmail(tail2);
    if (tail2Email) return tail2Email;

    return tail2 || "Unknown";
  }

  function formatTime(iso) {
    if (!iso) return "";
    const dt = new Date(iso);
    // Adjust the pattern to your preference
    const fmt = DateFormat.getDateTimeInstance({ pattern: "yyyy-MM-dd HH:mm:ss" });
    return fmt.format(dt);
  }

  function findEmailDeep(obj) {
    if (!obj || typeof obj !== "object") return null;
    for (const k in obj) {
      const v = obj[k];
      if (typeof v === "string") {
        const e = pickEmail(v);
        if (e) return e;
      } else if (v && typeof v === "object") {
        const e = findEmailDeep(v);
        if (e) return e;
      }
    }
    return null;
  }

  // Optional mapping from technical collection to friendly name
  function mapCollection(technical) {
    const map = {
      // add more if you like
      "Subaccount_Administrator": "Subaccount Administrator",
      "Business_Application_Studio_Administrator": "BAS Administrator"
    };
    return map[technical] || technical || "";
  }

  return {
    pickEmail,
    normalizeActor,
    formatTime,
    findEmailDeep,
    mapCollection
  };
});