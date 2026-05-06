sap.ui.define([], function () {
  "use strict";

  function normalize(value) {
    return String(value || "").toUpperCase().trim();
  }

  function normalizeText(value) {
    return String(value || "").toLowerCase().trim();
  }

  function hasAny(text, keywords) {
    return (keywords || []).some(function (keyword) {
      return text.includes(keyword);
    });
  }

  function startsWithAny(value, prefixes) {
    return (prefixes || []).some(function (prefix) {
      return value.startsWith(prefix);
    });
  }

  function exactMatch(value, exactList) {
    return (exactList || []).includes(value);
  }

  const RULES = [
    // =========================
    // TECHNICAL / BASIS
    // =========================
    {
      domain: "Technical",
      module: "Security",
      cluster: "Security & User Administration",
      exact: ["PFCG", "SU01", "SU10", "SUIM", "SU53", "SU24", "SU22", "SU25", "SU21"],
      prefixes: ["SU"],
      keywords: ["user", "authorization", "authorizations", "role", "roles", "profile", "profiles", "access", "auth"]
    },
    {
      domain: "Technical",
      module: "Monitoring",
      cluster: "System Monitoring & Diagnostics",
      exact: ["ST22", "ST03", "ST04", "ST06", "STAD", "SM21", "SM50", "SM51", "SM66"],
      prefixes: ["ST"],
      keywords: ["dump", "monitor", "trace", "workload", "system log", "performance", "diagnostic", "health check"]
    },
    {
      domain: "Technical",
      module: "Jobs",
      cluster: "Background Job Management",
      exact: ["SM36", "SM37", "SM35"],
      prefixes: [],
      keywords: ["background", "batch", "job", "jobs", "scheduler", "scheduling", "application jobs", "application job"]
    },
    {
      domain: "Technical",
      module: "Transport",
      cluster: "Transport Management",
      exact: ["SE09", "SE10", "STMS"],
      prefixes: [],
      keywords: ["transport", "request", "change request", "transport organizer", "correction request"]
    },
    {
      domain: "Technical",
      module: "Spool",
      cluster: "Spool & Output Management",
      exact: ["SP01", "SP02", "SPAD"],
      prefixes: ["SP"],
      keywords: ["spool", "print", "output"]
    },
    {
      domain: "Technical",
      module: "Interfaces",
      cluster: "RFC / Interface Management",
      exact: ["SM59", "/AIF/LOG"],
      prefixes: ["/AIF/"],
      keywords: ["rfc", "destination", "remote function", "interface", "integration", "idoc", "interface logs", "application interface framework"]
    },
    {
      domain: "Technical",
      module: "System Admin",
      cluster: "Client & System Administration",
      exact: ["SCC1", "SCC4"],
      prefixes: ["SCC"],
      keywords: ["client", "mandant", "client administration", "client copy", "system administration"]
    },
    {
      domain: "Technical",
      module: "ABAP",
      cluster: "ABAP Development / Repository Tools",
      exact: ["SE38", "SE80", "SE11", "SE37", "SE24", "SE93"],
      prefixes: ["SE"],
      keywords: ["repository", "abap", "dictionary", "development", "editor", "function builder", "class builder", "transaction", "reporting"]
    },
    {
      domain: "Technical",
      module: "Data",
      cluster: "Table Maintenance & Data Browser",
      exact: ["SE16", "SE16N", "SM30", "SM31"],
      prefixes: [],
      keywords: ["table", "data browser", "table maintenance", "view maintenance", "number range maintenance"]
    },
    {
      domain: "Technical",
      module: "Gateway",
      cluster: "Gateway / OData Services",
      exact: ["/IWFND/MAINT_SERVICE", "/IWBEP/REG_SERVICE"],
      prefixes: ["/IWFND/", "/IWBEP/"],
      keywords: ["odata", "gateway service", "maint service"]
    },
    {
      domain: "Technical",
      module: "Fiori",
      cluster: "SAP Fiori Launchpad & UI5 Apps",
      exact: ["F0000"],
      prefixes: [],
      keywords: ["fiori launchpad", "ui5 app", "launchpad"]
    },

    // =========================
    // FUNCTIONAL - MM / PROCUREMENT
    // =========================
    {
      domain: "Functional",
      module: "MM",
      cluster: "Material Master",
      exact: ["MM00", "MM01", "MM02", "MM03", "MM04", "MM06", "MM11", "MM12", "MM13", "MM14", "MM15", "MM16"],
      prefixes: ["MM"],
      keywords: ["material", "material master", "planned changes", "deletion flag", "change documents", "material via api"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Purchasing",
      exact: ["ME21N", "ME22N", "ME23N", "ME51N", "ME52N", "ME53N", "F0900", "F0350", "F0701"],
      prefixes: ["ME"],
      keywords: ["purchase", "purchasing", "document items", "purchase contract", "supplier balances", "supplier confirmation", "vendor", "procurement", "confirmation"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Inventory Management",
      exact: ["MIGO", "MB1A", "MB1B", "MB1C", "MB52"],
      prefixes: ["MB"],
      keywords: ["inventory", "goods movement", "stock", "material document", "warehouse stock"]
    },

    // =========================
    // FUNCTIONAL - SD
    // =========================
    {
      domain: "Functional",
      module: "SD",
      cluster: "Sales Order Management",
      exact: ["VA01", "VA02", "VA03", "F0029"],
      prefixes: ["VA"],
      keywords: ["sales order", "quotation", "customer order", "sales document", "sales order fulfillment"]
    },
    {
      domain: "Functional",
      module: "SD",
      cluster: "Delivery Processing",
      exact: ["VL01N", "VL02N", "VL03N"],
      prefixes: ["VL"],
      keywords: ["delivery", "outbound delivery", "shipping", "picking"]
    },
    {
      domain: "Functional",
      module: "SD",
      cluster: "Billing & Invoicing",
      exact: ["VF01", "VF02", "VF03"],
      prefixes: ["VF"],
      keywords: ["billing", "invoice", "invoicing", "billing document"]
    },

    // =========================
    // FUNCTIONAL - FI / AR / COLLECTIONS / TREASURY
    // =========================
    {
      domain: "Functional",
      module: "FI",
      cluster: "Financial Accounting",
      exact: ["FB01", "FB50", "FB60", "FB70", "FBL1N", "FBL3N", "FBL5N", "F000"],
      prefixes: ["FB", "FBL", "F-"],
      keywords: ["accounting", "financial", "general ledger", "accounts payable", "accounts receivable", "bank", "journal", "fiscal year"]
    },
    {
      domain: "Functional",
      module: "FI-AR",
      cluster: "Receivables & Collections",
      exact: ["F0106", "F0380"],
      prefixes: [],
      keywords: ["receivables", "collections", "collection worklist", "process receivables", "process collections"]
    },
    {
      domain: "Functional",
      module: "Treasury",
      cluster: "Treasury, Market & Derivatives",
      exact: ["HER1", "HER2", "HER3", "HERB"],
      prefixes: ["HER"],
      keywords: ["money market", "foreign exchange", "derivatives", "market structure", "treasury", "exchange rate", "capital gain", "tax use", "index values", "calculation rules", "calculation method", "calculation version"]
    },

    // =========================
    // FUNCTIONAL - CO / PP / APO / MRP
    // =========================
    {
      domain: "Functional",
      module: "CO",
      cluster: "Controlling",
      exact: ["KS01", "KS02", "KS03", "KP06"],
      prefixes: ["KS", "KP", "KO"],
      keywords: ["cost center", "internal order", "controlling", "planning", "profit center"]
    },
    {
      domain: "Functional",
      module: "PP",
      cluster: "Production Planning & MRP",
      exact: ["MD01", "MD02", "MD03", "CO01", "CO02", "CO03", "F0250", "F0270", "F0670"],
      prefixes: ["MD"],
      keywords: ["mrp", "external requirements", "internal requirements", "change requests - mrp", "planning package", "heuristic", "requirements"]
    },
    {
      domain: "Functional",
      module: "APO",
      cluster: "Supply Chain Planning / APO",
      exact: ["/ISAPAPO/HEUR1", "/ISAPAPO/HEUR2"],
      prefixes: ["/ISAPAPO/"],
      keywords: ["heuristic", "planning package", "supply chain", "apo"]
    },

    // =========================
    // FUNCTIONAL - QM / PM / LOGISTICS EXECUTION
    // =========================
    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Management",
      exact: ["F6607"],
      prefixes: ["QA", "QE", "QS"],
      keywords: ["inspection", "quality", "defect", "checklist", "quality management", "inspection checklist"]
    },
    {
      domain: "Functional",
      module: "LE",
      cluster: "Logistics Execution / Handling Unit",
      exact: ["HUEX"],
      prefixes: ["HU"],
      keywords: ["handling unit", "hu_", "shipment", "packing"]
    },
    {
      domain: "Functional",
      module: "PM",
      cluster: "Hierarchy & Maintenance Structures",
      exact: ["HIER"],
      prefixes: [],
      keywords: ["hierarchy maintenance", "application hierarchy", "maintenance hierarchy"]
    },

    // =========================
    // FUNCTIONAL - HCM / TRAVEL
    // =========================
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Human Capital Management",
      exact: ["PA20", "PA30", "PPOME"],
      prefixes: ["PA", "PE", "PT"],
      keywords: ["employee", "personnel", "hr", "human resources", "organizational management"]
    },
    {
      domain: "Functional",
      module: "Travel",
      cluster: "Travel & Expense",
      exact: ["F0409"],
      prefixes: [],
      keywords: ["travel requests", "travel", "expense"]
    },

    // =========================
    // FUNCTIONAL - MASTER DATA / BP / SUPPLIER / CUSTOMER
    // =========================
    {
      domain: "Functional",
      module: "Master Data",
      cluster: "Business Partner / Customer / Supplier",
      exact: ["BP", "XD01", "XD02", "XD03", "XK01", "XK02", "XK03", "MK01", "MK02", "MK03"],
      prefixes: ["XD", "XK", "MK", "BP"],
      keywords: ["business partner", "customer", "supplier", "vendor", "master data", "central supplier", "customer structure", "vendor structure"]
    },

    // =========================
    // FUNCTIONAL - CONFIGURATION
    // =========================
    {
      domain: "Functional",
      module: "Configuration",
      cluster: "Configuration",
      exact: ["SPRO", "HELP_CONFIG", "F6602"],
      prefixes: [],
      keywords: ["configuration", "customizing", "settings", "change logs", "local settings", "automatic help configuration"]
    },

    // =========================
    // FUNCTIONAL - COMMODITY / INDUSTRY SOLUTION
    // =========================
    {
      domain: "Functional",
      module: "Commodity Management",
      cluster: "Metals / Commodity Management",
      exact: ["/NFM/MM", "/NFM/SD", "/NFM/BSLM", "/NFM/BSLS", "/NFM/C_CO", "/NFM/ANARM", "/NFM/ANARS", "/NFM/CONVM", "/NFM/CONVS", "/NFM/COVM1", "/NFM/COVM3"],
      prefixes: ["/NFM/"],
      keywords: ["nf metals", "exchange key", "rate analysis", "currency conversion", "coverage", "metals", "commodity"]
    },

    // =========================
    // FUNCTIONAL - INDUSTRY / SPECIALIZED APPS
    // =========================
    {
      domain: "Functional",
      module: "Industry Solutions",
      cluster: "Industry-Specific Operations",
      exact: [],
      prefixes: ["/IACCGO/"],
      keywords: ["production services work center", "group categories", "global derived characteristics", "application group", "hlr event", "derived characteristics"]
    },
    {
      domain: "Functional",
      module: "Treasury",
      cluster: "Financial Rules, Indexes & Tax",
      exact: [],
      prefixes: ["/IATL/"],
      keywords: ["calculation rules", "index values", "index master", "calculation method", "calculation version", "capital gain", "tax use"]
    },
{
      domain: "Functional",
      module: "Configuration",
      cluster: "IMG / Configuration Maintenance",
      exact: ["CNV_IMG_MAIN", "CNV_IMG_ATTR", "CNV_IMG_CREATE", "MAINT_IMG"],
      prefixes: [],
      keywords: ["img maintenance", "maintain img", "create an img", "maintenance of img", "img attributes", "img sequence"]
    },
    {
      domain: "Functional",
      module: "Migration",
      cluster: "Migration & Conversion Management",
      exact: ["CNVMBTMON", "CNVMON", "CNVMBTINCL"],
      prefixes: ["CNV"],
      keywords: ["migration", "conversion", "conv.", "conv services", "migration process monitor", "includes for migration"]
    },
    {
      domain: "Functional",
      module: "Planning",
      cluster: "Forecasting & Planning",
      exact: ["CNFOWB"],
      prefixes: [],
      keywords: ["forecast workbench", "forecast", "planning"]
    },
    {
      domain: "Functional",
      module: "Project System",
      cluster: "Project Management",
      exact: ["DEVBOOK"],
      prefixes: [],
      keywords: ["project management", "project administration"]
    },
    {
      domain: "Functional",
      module: "Audit",
      cluster: "Audit & Compliance Configuration",
      exact: ["DEFAULTARA"],
      prefixes: [],
      keywords: ["audit area", "default audit area", "compliance"]
    },
    {
      domain: "Technical",
      module: "Demo",
      cluster: "Demo / Test Utilities",
      exact: ["DEMO_TCD", "DEMO_SCREEN_FLOW", "HELLO_T_WORLD"],
      prefixes: ["DEMO_"],
      keywords: ["demo", "hello world", "recording", "dynpro sequences", "test"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Procurement Follow-Up / Expediting",
      exact: ["DEXP"],
      prefixes: [],
      keywords: ["expediting"]
    },
    {
      domain: "Functional",
      module: "PP",
      cluster: "Production Order Configuration",
      exact: ["DEF_PO_SEARCH_PROC"],
      prefixes: [],
      keywords: ["prod. order", "production order", "search procedure"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Treasury & Payment Configuration",
      exact: ["DEFINE_PAYMENT_SYST", "DECK"],
      prefixes: [],
      keywords: ["payment systems", "cash holding", "payment", "banking"]
    },
    {
      domain: "Functional",
      module: "Mass Maintenance",
      cluster: "Mass Maintenance",
      exact: ["MASS_MEAN", "MASS_NUM_RANGE", "MASS_EINE", "MASS_VENDOR", "MASSP0BG", "MASSPRBG", "MASSVAR"],
      prefixes: ["MASS"],
      keywords: ["mass maintenance", "mass update", "mass vendor", "mass purchase", "display variants", "inforecord mass maintenance"]
    },
    {
      domain: "Functional",
      module: "Retail / Master Data",
      cluster: "Article / Material Hierarchy",
      exact: ["MATGRP01", "MATGRP02"],
      prefixes: ["MATGRP"],
      keywords: ["article hierarchy", "material hierarchy"]
    },
    {
      domain: "Functional",
      module: "Treasury",
      cluster: "Exposure Management",
      exact: ["MATREX"],
      prefixes: [],
      keywords: ["treasury exposure", "stock exposure", "material stock treasury exposure"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Bank Account Management",
      exact: ["FI12CORE", "FI12_O", "FI13_O", "FIOR"],
      prefixes: ["FI12", "FI13"],
      keywords: ["house banks", "bank accounts", "bank account", "house bank", "orbian bank"]
    },
    {
      domain: "Functional",
      module: "FI-AR",
      cluster: "Interest Calculation",
      exact: ["FIOA"],
      prefixes: [],
      keywords: ["interest on arrears", "interest calculation"]
    },
    {
      domain: "Functional",
      module: "FI-AP",
      cluster: "Invoice Processing",
      exact: ["FIKZRGIN"],
      prefixes: [],
      keywords: ["incoming invoice", "invoice number range"]
    },
    {
      domain: "Functional",
      module: "Public Sector",
      cluster: "Funds Management",
      exact: ["FIPOS"],
      prefixes: [],
      keywords: ["commitment items", "funds management"]
    },
    {
      domain: "Functional",
      module: "Inventory",
      cluster: "Inventory Valuation / FIFO",
      exact: ["FIFO_PROFILE"],
      prefixes: ["FIFO"],
      keywords: ["fifo profile", "fifo"]
    },
    {
      domain: "Functional",
      module: "Banking",
      cluster: "Mandate Management",
      exact: ["FIDDMNOCI"],
      prefixes: [],
      keywords: ["mandate changes", "mandate", "import notification"]
    },
    {
      domain: "Functional",
      module: "FI-AA",
      cluster: "Asset Accounting",
      exact: ["FIRU_INV1"],
      prefixes: [],
      keywords: ["fixed assets", "inventory list of fixed assets", "asset accounting"]
    },
    {
      domain: "Functional",
      module: "Master Data",
      cluster: "Product Master & Attributes",
      exact: ["FIPRC2", "FIPRC3", "FIPRC4"],
      prefixes: ["FIPRC"],
      keywords: ["product category", "attributes", "key prefix", "maintain attributes"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Derivation & Finance Rules",
      exact: ["FINDR0"],
      prefixes: [],
      keywords: ["derivation tool", "parametertransaction derivation", "derivation"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "FI Configuration / Number Range Management",
      exact: ["FIOTP_NRIV", "FZBR"],
      prefixes: ["FIOTP"],
      keywords: ["one-time postings", "number range maint", "number range maintenance", "posting application", "posting types"]
    },
    {
      domain: "Functional",
      module: "Localization",
      cluster: "Localization Configuration",
      exact: ["LOP_CUST", "LOCA_CUST", "LOPFT_CUST"],
      prefixes: ["LOP_", "LOCA_"],
      keywords: ["customizing", "locator customizing", "logistical option", "configuration"]
    },
    {
      domain: "Functional",
      module: "Localization",
      cluster: "Localization Master Data",
      exact: ["LOP_MASTER", "LOP_LISTS"],
      prefixes: [],
      keywords: ["maintain master data", "search documents", "local master data", "documents"]
    },
    {
      domain: "Functional",
      module: "Brazil Localization",
      cluster: "Brazil Tax & Nota Fiscal",
      exact: [
        "LOGBR_CNAE_SRVC",
        "LOGBR_WHT_CUSTV",
        "LOGBR_MM_SIMPLES",
        "LOGBR_NFSE_UPLOAD",
        "LOGBR_NFSE_DOWNLOAD",
        "LOGBR_NFE_CTRL_MSG",
        "LOGBR_PART_CTRL_MSG"
      ],
      prefixes: ["LOGBR_"],
      keywords: ["nota fiscal", "nf-e", "nfse", "cnae", "simples", "withholding", "brazil", "service nota fiscal", "message control"]
    },
    {
      domain: "Technical",
      module: "License Measurement",
      cluster: "System Measurement & Licensing",
      exact: ["USMM", "USMM2", "USMM_NOTES", "USMM_OLD", "USMM_PDF"],
      prefixes: ["USMM"],
      keywords: ["system measurement", "measurement", "licensing", "notes check", "usmm settings"]
    },
    {
      domain: "Functional",
      module: "MDG",
      cluster: "Master Data Governance",
      exact: [
        "USMD_RULE",
        "USMD_DIS_SERVICE",
        "USMD_DIS_SYSTEMS",
        "USMD_ARC_RDT",
        "USMD_SSW_RULE",
        "USMD_TRANSPORT_TRVAR",
        "USMD_DIS_PACKAGE"
      ],
      prefixes: ["USMD"],
      keywords: [
        "validations and derivations",
        "replication services",
        "assign systems",
        "master data packages",
        "residence time",
        "change request",
        "process definition",
        "transport data transfer variants",
        "master data governance",
        "md packages"
      ]
    },
    {
      domain: "Functional",
      module: "A&D",
      cluster: "Aerospace & Defense",
      exact: ["ADOM", "ADIP", "ADSPCIP"],
      prefixes: ["AD"],
      keywords: ["a&d", "spec 2000", "initial provisioning", "file upload to erp"]
    },
    {
      domain: "Functional",
      module: "PM/PS",
      cluster: "PM / PS Integration",
      exact: ["ADPMPS", "ADPMPS2"],
      prefixes: [],
      keywords: ["pm/ps integration", "pm ps integration"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Subcontracting Monitoring",
      exact: ["ADSUBCON"],
      prefixes: [],
      keywords: ["subcontracting monitor", "subcontracting"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "General Ledger Posting",
      exact: ["AD08"],
      prefixes: [],
      keywords: ["g/l account posting", "gl account posting", "general ledger"]
    },
    {
      domain: "Functional",
      module: "FI-AP",
      cluster: "Payments & Down Payments",
      exact: ["AD1T"],
      prefixes: [],
      keywords: ["down payment requests", "clear down payment"]
    },
    {
      domain: "Functional",
      module: "Configuration",
      cluster: "IMG Search Help & Matchcode Maintenance",
      exact: ["AD20", "AD21"],
      prefixes: [],
      keywords: ["search help maintenance", "matchcode maintenance", "for img"]
    },
    {
      domain: "Functional",
      module: "Project System",
      cluster: "Project Planning & Costing",
      exact: ["AD31", "AD32", "AD3P"],
      prefixes: [],
      keywords: ["plan data handling", "costs-to-complete", "plan data handling profile", "profile"]
    },
    {
      domain: "Technical",
      module: "Business Rules",
      cluster: "Business Rule Framework",
      exact: ["BRF"],
      prefixes: ["BRF"],
      keywords: ["business rule framework", "workbench", "rules framework"]
    },
    {
      domain: "Technical",
      module: "Integration",
      cluster: "Data Transfer & ALE Integration",
      exact: ["BDBR", "BDLR", "BKDR"],
      prefixes: ["BD"],
      keywords: ["register bapi", "data transfer", "transfer program", "transfer rules", "ale"]
    },
    {
      domain: "Technical",
      module: "Recovery",
      cluster: "Recovery & ALE Monitoring",
      exact: ["BDR1", "BDR2", "BDRC", "BDRL"],
      prefixes: ["BDR"],
      keywords: ["recovery", "recovery data", "recovery objects", "application log", "ale"]
    },
    {
      domain: "Technical",
      module: "Workflow",
      cluster: "Business Events & Workflow",
      exact: ["BERE"],
      prefixes: [],
      keywords: ["business event repository", "business events", "event repository"]
    },
    {
      domain: "Functional",
      module: "Process Management",
      cluster: "Business Process Management",
      exact: ["BERP"],
      prefixes: [],
      keywords: ["business processes"]
    },
    {
      domain: "Functional",
      module: "Configuration",
      cluster: "Business Feature Configuration",
      exact: ["BFTR"],
      prefixes: [],
      keywords: ["business feature", "maintain business feature"]
    },
    {
      domain: "Functional",
      module: "Utilities",
      cluster: "IS-U Number Range Management",
      exact: ["BNR"],
      prefixes: [],
      keywords: ["isu_", "isu", "number range maintenance"]
    },
    {
      domain: "Technical",
      module: "API",
      cluster: "API & Cross-Application Services",
      exact: ["BCUR"],
      prefixes: [],
      keywords: ["released apis", "api", "package bcur"]
    },
    {
      domain: "Functional",
      module: "Utilities",
      cluster: "System Measurement Personalization",
      exact: ["USMM_MASS_PERSOBJ"],
      prefixes: [],
      keywords: ["mass maintenance personaliz. object", "personalization object"]
    },{
      domain: "Technical",
      module: "Basis",
      cluster: "Basis Utilities",
      exact: ["BASIS_CL01", "BASIS_CL02", "BASIS_O1CL"],
      prefixes: ["BASIS_"],
      keywords: ["call cl01", "call cl02", "call o1cl", "basis"]
    },
    {
      domain: "Technical",
      module: "API",
      cluster: "BAPI Tools & Explorer",
      exact: ["BAPI", "BAPIW", "BAPI45", "BAPIPPLAN"],
      prefixes: ["BAPI"],
      keywords: ["bapi explorer", "bapi browser", "payment plan bapis", "bapi"]
    },
    {
      domain: "Functional",
      module: "Banking",
      cluster: "Banking & Payment Processing",
      exact: ["BANK", "BANK_PP_SETTINGS", "BAUP"],
      prefixes: ["BANK"],
      keywords: ["bank", "bank data", "payment processing", "apply bank data", "current settings for par processing"]
    },
    {
      domain: "Technical",
      module: "ALE",
      cluster: "ALE Administration",
      exact: ["BALA", "BALM"],
      prefixes: [],
      keywords: ["ale application menu", "ale master data", "ale"]
    },
    {
      domain: "Technical",
      module: "Batch",
      cluster: "Batch Processing Tools",
      exact: ["BALV"],
      prefixes: [],
      keywords: ["batch list viewer", "batch"]
    },
    {
      domain: "Functional",
      module: "Batch / Number Range",
      cluster: "Batch Number Range Management",
      exact: ["BARNO"],
      prefixes: [],
      keywords: ["number range editing", "batch", "number range"]
    },

    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Notifications",
      exact: ["QM00", "QM01", "QM02", "QM03", "QM10", "QM11", "QM19", "QM50"],
      prefixes: ["QM"],
      keywords: ["quality notification", "quality notifications", "q notifications", "timeline display q notifications", "multilevel list of q notifications"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Notification Tasks",
      exact: ["QM12", "QM13"],
      prefixes: [],
      keywords: ["change tasks", "display tasks", "tasks"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Notification Items",
      exact: ["QM14", "QM15"],
      prefixes: [],
      keywords: ["change items", "display items", "items"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Notification Activities",
      exact: ["QM16", "QM17"],
      prefixes: [],
      keywords: ["change activities", "display activities", "activities"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "FMEA & Quality Analysis",
      exact: ["QM_FMEA"],
      prefixes: [],
      keywords: ["fmea cockpit", "fmea"]
    },

    {
      domain: "Functional",
      module: "HCM",
      cluster: "HR Query & Analytics",
      exact: ["PMAH", "PMIS", "PM24"],
      prefixes: [],
      keywords: ["hr-fpm", "ad hoc query", "his for hr", "display data records", "hr dbw"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Infotype & Feature Configuration",
      exact: ["PM01", "PM03"],
      prefixes: [],
      keywords: ["enhance infotypes", "infotypes", "features number range", "maintain features"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Statements & Forms",
      exact: ["PM10", "PM11", "PM12", "PM13", "PM20", "PM22", "PM23", "PM30"],
      prefixes: [],
      keywords: [
        "statements selection",
        "statements single entry",
        "statements fast entry",
        "statements print",
        "statements with sapscript",
        "copy and delete statement",
        "statements collector",
        "interactive forms"
      ]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Position Management",
      exact: ["PMB0"],
      prefixes: ["PMB"],
      keywords: ["position management", "plan version", "position management plan version"]
    },
    {
      domain: "Functional",
      module: "Budget",
      cluster: "Budget Planning & Control",
      exact: ["PMB1"],
      prefixes: [],
      keywords: ["overall budget", "change overall budget", "budget"]
    },
    {
      domain: "Functional",
      module: "Classification",
      cluster: "Classification & Class Management",
      exact: [
        "CL01", "CL02", "CL03", "CL04",
        "CL20", "CL21", "CL22", "CL23", "CL24", "CL25",
        "CL2A", "CL2B", "CL30", "CL31", "CL6A"
      ],
      prefixes: ["CL"],
      keywords: [
        "create class",
        "classes",
        "display class",
        "delete class",
        "assign object to classes",
        "display object in classes",
        "allocate class to classes",
        "display class for classes",
        "assign objects to one class",
        "display objects in class",
        "classification status",
        "class types",
        "find objects in classes",
        "find object in class type",
        "class list",
        "classification"
      ]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Lockbox Processing",
      exact: ["FLB1", "FLB2", "FLBP"],
      prefixes: ["FLB"],
      keywords: [
        "postprocessing lockbox data",
        "import lockbox file",
        "post lockbox data",
        "lockbox"
      ]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Financial Assignment & Reconciliation",
      exact: ["FLQAB", "FLQAC", "FLQAD", "FLQAF", "FLQC9"],
      prefixes: ["FLQA", "FLQ"],
      keywords: [
        "assignment from bank statement",
        "assignment from fi information",
        "assignment from invoices",
        "assignment from document chains",
        "delete flow data",
        "assignment",
        "reconciliation",
        "flow data"
      ]
    },
    {
      domain: "Functional",
      module: "Packaging",
      cluster: "Returnable Packaging Management",
      exact: [
        "RL00", "RL01", "RL02", "RL03", "RL04", "RL05",
        "RL07", "RL11", "RL12", "RL14", "RL15", "RL16",
        "RL23", "RL24", "RL34"
      ],
      prefixes: ["RL"],
      keywords: [
        "returnable packaging",
        "ret packaging",
        "ret pcking",
        "packaging account",
        "rp account posting",
        "reprocess rp account postings",
        "archive account postings",
        "read account postings from archive",
        "purchase order for ret packaging",
        "matching via statements",
        "acct balances per rtnpck",
        "returnable packaging account"
      ]
    },{
      domain: "Technical",
      module: "Workflow",
      cluster: "Workflow & Business Workplace",
      exact: ["SBWP", "SWI1", "SWI2_FREQ", "SWDD", "SWDD_SCENARIO", "SWU3"],
      prefixes: ["SW"],
      keywords: ["workflow", "business workplace", "work item", "workflow builder", "workflow customizing"]
    },
    {
      domain: "Technical",
      module: "Output",
      cluster: "Output Determination & Forms",
      exact: ["NACE", "SMARTFORMS", "SFP", "SO10"],
      prefixes: [],
      keywords: ["output determination", "smartforms", "adobe forms", "standard text", "form", "forms", "sapscript"]
    },
    {
      domain: "Technical",
      module: "Spool",
      cluster: "Spool & Print Administration",
      exact: ["SP01", "SP02", "SPAD", "SPFP"],
      prefixes: ["SP"],
      keywords: ["spool", "print", "output", "printing", "printer"]
    },
    {
      domain: "Technical",
      module: "Scheduling",
      cluster: "Background Job Scheduling",
      exact: ["SM36", "SM37"],
      prefixes: [],
      keywords: ["background job", "batch job", "job scheduling", "job monitor"]
    },
    {
      domain: "Technical",
      module: "Monitoring",
      cluster: "System Logs & Runtime Monitoring",
      exact: ["SM21", "ST22", "SM50", "SM51", "SM66", "ST06", "ST03N", "STAD"],
      prefixes: ["ST"],
      keywords: ["system log", "dump", "runtime", "monitor", "work process", "performance", "workload"]
    },
    {
      domain: "Technical",
      module: "Transport",
      cluster: "Transport Organizer & Import Management",
      exact: ["SE09", "SE10", "STMS"],
      prefixes: [],
      keywords: ["transport", "change request", "transport organizer", "import queue", "transport management"]
    },
    {
      domain: "Technical",
      module: "RFC",
      cluster: "RFC Destinations & Connectivity",
      exact: ["SM59"],
      prefixes: [],
      keywords: ["rfc", "destination", "connectivity", "remote function"]
    },
    {
      domain: "Technical",
      module: "Gateway",
      cluster: "OData / Gateway Services",
      exact: ["/IWFND/MAINT_SERVICE", "/IWBEP/REG_SERVICE"],
      prefixes: ["/IWFND/", "/IWBEP/"],
      keywords: ["odata", "gateway", "maint service", "service catalog", "api"]
    },
    {
      domain: "Technical",
      module: "User Administration",
      cluster: "Users, Roles & Authorizations",
      exact: ["SU01", "SU10", "SUIM", "SU53", "SU24", "SU21", "PFCG"],
      prefixes: ["SU"],
      keywords: ["user", "role", "authorization", "auth", "profile", "access", "maintain user", "role maintenance"]
    },
    {
      domain: "Technical",
      module: "Tables",
      cluster: "Table Maintenance & Browser",
      exact: ["SE16", "SE16N", "SM30", "SM31"],
      prefixes: [],
      keywords: ["table maintenance", "view maintenance", "data browser", "table", "maintain entries"]
    },
    {
      domain: "Technical",
      module: "ABAP",
      cluster: "ABAP Development & Repository",
      exact: ["SE38", "SE80", "SE37", "SE24", "SE11", "SE93"],
      prefixes: ["SE"],
      keywords: ["abap", "repository", "function builder", "class builder", "dictionary", "editor", "transaction code"]
    },
    {
      domain: "Technical",
      module: "Batch Input",
      cluster: "Batch Input & Session Management",
      exact: ["SM35", "SHDB"],
      prefixes: [],
      keywords: ["batch input", "recording", "session management"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Material Master",
      exact: ["MM00", "MM01", "MM02", "MM03", "MM04", "MM06"],
      prefixes: ["MM"],
      keywords: ["material", "material master", "material changes", "display material", "change material"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Purchasing",
      exact: ["ME21N", "ME22N", "ME23N", "ME51N", "ME52N", "ME53N"],
      prefixes: ["ME"],
      keywords: ["purchase order", "purchase requisition", "purchasing", "procurement", "vendor", "supplier"]
    },
    {
      domain: "Functional",
      module: "MM",
      cluster: "Inventory Management",
      exact: ["MIGO", "MB1A", "MB1B", "MB1C", "MB52"],
      prefixes: ["MB"],
      keywords: ["goods movement", "inventory", "stock", "material document", "warehouse stock"]
    },
    {
      domain: "Functional",
      module: "SD",
      cluster: "Sales Order Processing",
      exact: ["VA01", "VA02", "VA03"],
      prefixes: ["VA"],
      keywords: ["sales order", "sales document", "customer order", "quotation"]
    },
    {
      domain: "Functional",
      module: "SD",
      cluster: "Delivery & Shipping",
      exact: ["VL01N", "VL02N", "VL03N"],
      prefixes: ["VL"],
      keywords: ["delivery", "shipping", "outbound delivery", "picking"]
    },
    {
      domain: "Functional",
      module: "SD",
      cluster: "Billing",
      exact: ["VF01", "VF02", "VF03"],
      prefixes: ["VF"],
      keywords: ["billing", "invoice", "billing document", "invoicing"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "General Ledger & Accounting",
      exact: ["FB01", "FB50", "FBL3N"],
      prefixes: ["FB"],
      keywords: ["general ledger", "g/l account", "accounting", "financial accounting", "journal"]
    },
    {
      domain: "Functional",
      module: "FI-AP",
      cluster: "Accounts Payable",
      exact: ["FB60", "FBL1N"],
      prefixes: [],
      keywords: ["accounts payable", "vendor invoice", "incoming invoice", "supplier invoice", "ap"]
    },
    {
      domain: "Functional",
      module: "FI-AR",
      cluster: "Accounts Receivable",
      exact: ["FB70", "FBL5N"],
      prefixes: [],
      keywords: ["accounts receivable", "customer invoice", "receivables", "customer account", "ar"]
    },
    {
      domain: "Functional",
      module: "FI-AA",
      cluster: "Asset Accounting",
      exact: ["AS01", "AS02", "AS03"],
      prefixes: ["AS"],
      keywords: ["asset", "fixed asset", "asset accounting"]
    },
    {
      domain: "Functional",
      module: "Banking",
      cluster: "House Banks & Bank Accounts",
      exact: ["FI12", "FI12_HBANK", "FI13"],
      prefixes: ["FI12", "FI13"],
      keywords: ["house bank", "bank account", "bank accounts", "house banks"]
    },
    {
      domain: "Functional",
      module: "CO",
      cluster: "Cost Center & Internal Orders",
      exact: ["KS01", "KS02", "KS03", "KO01", "KO02", "KO03"],
      prefixes: ["KS", "KO"],
      keywords: ["cost center", "internal order", "controlling", "order master data"]
    },
    {
      domain: "Functional",
      module: "PP",
      cluster: "MRP & Production Orders",
      exact: ["MD01", "MD02", "MD03", "CO01", "CO02", "CO03"],
      prefixes: ["MD", "CO"],
      keywords: ["mrp", "planned order", "production order", "requirements planning", "production planning"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "Quality Management",
      exact: ["QM00", "QM01", "QM02", "QM03", "QM10", "QM11", "QM12", "QM13", "QM14", "QM15", "QM16", "QM17", "QM19", "QM50"],
      prefixes: ["QM"],
      keywords: ["quality", "quality notification", "tasks", "items", "activities", "quality notifications"]
    },
    {
      domain: "Functional",
      module: "QM",
      cluster: "FMEA & Quality Analysis",
      exact: ["QM_FMEA"],
      prefixes: [],
      keywords: ["fmea", "fmea cockpit", "quality analysis"]
    },
    {
      domain: "Functional",
      module: "PM",
      cluster: "Maintenance Orders & Equipment",
      exact: ["IW31", "IW32", "IW33", "IL01", "IL02", "IL03", "IP01", "IP02", "IP03"],
      prefixes: ["IW", "IL", "IP"],
      keywords: ["maintenance order", "equipment", "functional location", "maintenance plan"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Personnel Administration",
      exact: ["PA20", "PA30"],
      prefixes: ["PA"],
      keywords: ["personnel", "employee", "infotype", "hr"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Organizational Management",
      exact: ["PPOME"],
      prefixes: [],
      keywords: ["organizational management", "org management", "position", "org unit"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Payroll / Statements / Forms",
      exact: ["PM10", "PM11", "PM12", "PM13", "PM20", "PM22", "PM23", "PM30"],
      prefixes: [],
      keywords: ["statements", "statement", "sapscript", "interactive forms", "payroll"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "HR Queries & Analytics",
      exact: ["PMAH", "PMIS", "PM24"],
      prefixes: [],
      keywords: ["ad hoc query", "his for hr", "display data records", "analytics"]
    },
    {
      domain: "Functional",
      module: "HCM",
      cluster: "Infotype / Feature Configuration",
      exact: ["PM01", "PM03"],
      prefixes: [],
      keywords: ["enhance infotypes", "maintain features", "feature number range", "infotypes"]
    },
    {
      domain: "Functional",
      module: "Budget",
      cluster: "Budget Planning & Control",
      exact: ["PMB0", "PMB1"],
      prefixes: ["PMB"],
      keywords: ["plan version", "overall budget", "budget"]
    },
    {
      domain: "Functional",
      module: "MDG",
      cluster: "Master Data Governance",
      exact: ["USMD_RULE", "USMD_DIS_SERVICE", "USMD_DIS_SYSTEMS", "USMD_ARC_RDT", "USMD_SSW_RULE", "USMD_TRANSPORT_TRVAR", "USMD_DIS_PACKAGE"],
      prefixes: ["USMD"],
      keywords: ["master data governance", "replication", "derivation", "validation", "change request", "packages"]
    },
    {
      domain: "Technical",
      module: "Licensing",
      cluster: "System Measurement & Licensing",
      exact: ["USMM", "USMM2", "USMM_NOTES", "USMM_OLD", "USMM_PDF"],
      prefixes: ["USMM"],
      keywords: ["system measurement", "licensing", "measurement", "notes check"]
    },
    {
      domain: "Functional",
      module: "Classification",
      cluster: "Classification & Class Management",
      exact: ["CL01", "CL02", "CL03", "CL04", "CL20", "CL21", "CL22", "CL23", "CL24", "CL25", "CL2A", "CL2B", "CL30", "CL31", "CL6A"],
      prefixes: ["CL"],
      keywords: ["class", "classes", "classification", "class type", "assign object to classes", "find objects in classes", "classification status"]
    },
    {
      domain: "Functional",
      module: "Packaging",
      cluster: "Returnable Packaging Management",
      exact: ["RL00", "RL01", "RL02", "RL03", "RL04", "RL05", "RL07", "RL11", "RL12", "RL14", "RL15", "RL16", "RL23", "RL24", "RL34"],
      prefixes: ["RL"],
      keywords: ["returnable packaging", "packaging account", "account posting", "ret packaging", "matching via statements", "archive account postings"]
    },
    {
      domain: "Functional",
      module: "Customer Master",
      cluster: "Customer Master Management",
      exact: ["FLCC1", "FLCC2", "FLCC3", "FLCU1", "FLCU2", "FLCU3"],
      prefixes: ["FLCC", "FLCU"],
      keywords: ["create customer", "change customer", "display customer"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Lockbox Processing",
      exact: ["FLB1", "FLB2", "FLBP"],
      prefixes: ["FLB"],
      keywords: ["lockbox", "import lockbox file", "post lockbox data", "postprocessing lockbox"]
    },
    {
      domain: "Functional",
      module: "FI",
      cluster: "Financial Assignment & Reconciliation",
      exact: ["FLQAB", "FLQAC", "FLQAD", "FLQAF", "FLQC9"],
      prefixes: ["FLQ"],
      keywords: ["assignment from bank statement", "assignment from fi information", "assignment from invoices", "document chains", "flow data", "reconciliation"]
    },
    {
      domain: "Functional",
      module: "Configuration",
      cluster: "Cross-Application Configuration",
      exact: ["FLETS", "SPRO"],
      prefixes: [],
      keywords: ["field length extension", "topic switch", "configuration", "customizing", "settings"]
    },
    {
      domain: "Functional",
      module: "Localization",
      cluster: "Brazil Tax & Nota Fiscal",
      exact: ["LOGBR_CNAE_SRVC", "LOGBR_WHT_CUSTV", "LOGBR_MM_SIMPLES", "LOGBR_NFSE_UPLOAD", "LOGBR_NFSE_DOWNLOAD", "LOGBR_NFE_CTRL_MSG", "LOGBR_PART_CTRL_MSG"],
      prefixes: ["LOGBR_"],
      keywords: ["nota fiscal", "nf e", "nfse", "cnae", "simples", "withholding", "brazil", "service nota fiscal", "message control"]
    },
    {
      domain: "Technical",
      module: "Demo",
      cluster: "Demo / Test Utilities",
      exact: ["DEMO_TCD", "DEMO_SCREEN_FLOW", "HELLO_T_WORLD", "LOCA"],
      prefixes: ["DEMO_"],
      keywords: ["demo", "hello world", "recording", "dynpro", "test", "locator demo"]
    },
    {
      domain: "Functional",
      module: "Localization",
      cluster: "Localization Configuration",
      exact: ["LOP_CUST", "LOCA_CUST", "LOPFT_CUST"],
      prefixes: ["LOP_", "LOCA_"],
      keywords: ["customizing", "logistical option", "locator customizing", "configuration"]
    },
    {
      domain: "Functional",
      module: "Master Data",
      cluster: "Business Partner / Customer / Supplier",
      exact: ["BP", "XD01", "XD02", "XD03", "XK01", "XK02", "XK03", "MK01", "MK02", "MK03"],
      prefixes: ["XD", "XK", "MK", "BP"],
      keywords: ["business partner", "customer", "supplier", "vendor", "master data", "central supplier"]
    },
    {
      domain: "Technical",
      module: "API",
      cluster: "API & Cross-Application Services",
      exact: ["BAPI", "BAPIW", "BAPI45", "BCUR"],
      prefixes: ["BAPI"],
      keywords: ["bapi", "api", "released apis", "bapi explorer", "bapi browser"]
    },
    {
      domain: "Technical",
      module: "ALE",
      cluster: "Data Transfer & ALE Integration",
      exact: ["BALA", "BALM", "BDBR", "BDLR", "BKDR"],
      prefixes: ["BD"],
      keywords: ["ale", "data transfer", "register bapi", "transfer program", "transfer rules", "master data distribution"]
    },
    {
      domain: "Technical",
      module: "Recovery",
      cluster: "Recovery & ALE Monitoring",
      exact: ["BDR1", "BDR2", "BDRC", "BDRL"],
      prefixes: ["BDR"],
      keywords: ["recovery", "application log", "recovery data", "recovery objects"]
    },
    {
      domain: "Technical",
      module: "Workflow",
      cluster: "Business Events & Workflow",
      exact: ["BERE", "SBWP", "SWI1", "SWDD", "SWU3"],
      prefixes: ["SW"],
      keywords: ["business event repository", "workflow", "business workplace", "work item", "workflow builder"]
    },
    {
      domain: "Technical",
      module: "Rules",
      cluster: "Business Rule Framework",
      exact: ["BRF"],
      prefixes: ["BRF"],
      keywords: ["business rule framework", "rule framework", "workbench"]
    },
    {
      domain: "Functional",
      module: "Treasury",
      cluster: "Banking & Payment Processing",
      exact: ["BANK", "BANK_PP_SETTINGS", "BAUP"],
      prefixes: ["BANK"],
      keywords: ["bank", "bank data", "payment processing", "apply bank data"]
    },
    // =========================
    // FALLBACK CROSS-APPLICATION
    // =========================
    {
      domain: "Functional",
      module: "Cross Application",
      cluster: "Application Log & Cross-Application Services",
      exact: ["SLG1", "SLG0", "F6619"],
      prefixes: [],
      keywords: ["application log", "archiving", "api", "cross-application", "event-based", "workflow", "reverse event-based", "archiving of bank data storage"]
    }
  ];

  function scoreRule(rule, tcode, desc, program) {
    let score = 0;

    if (exactMatch(tcode, rule.exact)) {
      score += 8;
    }

    if (startsWithAny(tcode, rule.prefixes)) {
      score += 4;
    }

    if (hasAny(desc, rule.keywords)) {
      score += 3;
    }

    if (hasAny(program, rule.keywords)) {
      score += 1;
    }

    return score;
  }

  function classify(item) {
    const tcode = normalize(item.tcode);
    const desc = normalizeText(item.desc);
    const program = normalizeText(item.program);

    let best = {
      domain: "Functional",
      module: "Other",
      cluster: item.cluster || "Functional Other",
      score: 0
    };

    RULES.forEach(function (rule) {
      const score = scoreRule(rule, tcode, desc, program);

      if (score > best.score) {
        best = {
          domain: rule.domain,
          module: rule.module,
          cluster: rule.cluster,
          score: score
        };
      }
    });

    return best;
  }

  function enrichItem(item) {
    const classification = classify(item);

    return Object.assign({}, item, {
      domain: classification.domain,
      module: classification.module,
      cluster: classification.cluster,
      clusterScore: classification.score
    });
  }

  return {
    classify: classify,
    enrichItem: enrichItem
  };
});