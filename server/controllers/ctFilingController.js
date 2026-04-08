import XLSX from "xlsx-js-style";
import { pool } from "../db.js";

// Helper function to create a sheet from objects
function sheetFromObjects(rows, order) {
  const headers = order;
  const data = [
    headers,
    ...rows.map((r) => order.map((k) => (r[k] === undefined ? null : r[k]))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);

  const baseCols = order.map((k) => ({
    wch: Math.max(12, Math.min(40, k.length + 4)),
  }));

  const widen = (name, wch) => {
    const i = order.indexOf(name);
    if (i !== -1) baseCols[i] = { wch };
  };

  // Widen specific columns based on content type
  order.forEach((key) => {
    if (
      key.includes("SUPPLIER") ||
      key.includes("VENDOR") ||
      key.includes("PARTY")
    ) {
      widen(key, 36);
    } else if (key.includes("DATE")) {
      widen(key, 12);
    } else if (key.includes("NUMBER") || key.includes("TRN")) {
      widen(key, 20);
    } else if (key.includes("SOURCE")) {
      widen(key, 40);
    } else if (key.includes("ZERO RATED")) {
      widen(key, 18);
    }
  });

  ws["!cols"] = baseCols;

  ws["!freeze"] = {
    xSplit: "0",
    ySplit: "1",
    topLeftCell: "A2",
    activePane: "bottomLeft",
    state: "frozen",
  };

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    const cell = ws[addr] || (ws[addr] = { t: "s", v: headers[C] });
    cell.s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center", wrapText: true },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  const numericCols = new Set([
    "BEFORE TAX AMOUNT",
    "VAT",
    "NET AMOUNT",
    "BEFORE TAX (AED)",
    "VAT (AED)",
    "ZERO RATED (AED)",
    "NET AMOUNT (AED)",
    "AMOUNT",
    "DEBIT",
    "CREDIT",
    "BALANCE",
  ]);

  for (let R = 1; R <= range.e.r; ++R) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const k = order[C];
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (!cell) continue;
      if (k === "SUPPLIER/VENDOR" || k === "DESCRIPTION") {
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), wrapText: true },
        };
      }
      if (k === "DATE") {
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "center" },
        };
      }
      if (numericCols.has(k) && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
        };
      }
    }
  }

  return ws;
}

// Helper function to create a summary sheet

function summarySheet({ beforeTax, vat, net, zero = 0 }) {
  const data = [
    ["Metric", "Amount"],
    ["STANDARD RATED SUPPLIES", beforeTax],
    ["OUTPUT TAX", vat],
    ["TOTAL AMOUNT INCLUDING VAT", net],
    ["ZERO RATED SUPPLIES", zero],
    ["EXEMPTED SUPPLIES", 0],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // widths
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }];

  // header style
  for (let c = 0; c < 2; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    ws[addr].s = {
      font: { bold: true },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "F2F2F2" } },
    };
  }

  // number format on amount cells
  for (let r = 1; r <= 4; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 1 });
    const cell = ws[addr] || (ws[addr] = {});
    cell.t = "n";
    cell.z = "#,##0.00";
    cell.s = {
      ...(cell.s || {}),
      alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
    };
  }

  return ws;
}

function bankAccountSummarySheet(summary = {}) {
  if (!summary || typeof summary !== "object") return null;

  const entries = Object.entries(summary).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== ""
  );
  if (!entries.length) return null;

  const data = [["Field", "Value"], ...entries.map(([k, v]) => [k, String(v)])];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths
  ws["!cols"] = [
    { wch: 30 }, // Field
    { wch: 60 }, // Value
  ];

  // Header style
  for (let c = 0; c < 2; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = ws[addr] || (ws[addr] = {});
    cell.s = {
      font: { bold: true, color: { rgb: "FFFFFFFF" } },
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      fill: { patternType: "solid", fgColor: { rgb: "FF486581" } },
    };
  }

  // Body cells – border + alignment
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 1; r <= range.e.r; r++) {
    for (let c = 0; c <= 1; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = {});
      cell.s = {
        ...(cell.s || {}),
        alignment: {
          ...(cell.s?.alignment || {}),
          horizontal: "left",
          vertical: "center",
          wrapText: true,
        },
        border: {
          top: { style: "thin", color: { rgb: "FFE1E6EB" } },
          left: { style: "thin", color: { rgb: "FFE1E6EB" } },
          right: { style: "thin", color: { rgb: "FFE1E6EB" } },
          bottom: { style: "thin", color: { rgb: "FFE1E6EB" } },
        },
      };
    }
  }

  return ws;
}

function ctSummarySheet(
  a = {},
  b = {},
  labelA = "Sales",
  labelB = "Purchases",
  opts = { layout: "columns", header: {} } // header: { supplierVendor, supplierTRN, taxPeriod, title }
) {
  const A = {
    beforeTax: Number(a.beforeTax || 0),
    vat: Number(a.vat || 0),
    net: Number(a.net || 0),
    zero: Number(a.zero || 0),
  };
  const B = {
    beforeTax: Number(b.beforeTax || 0),
    vat: Number(b.vat || 0),
    net: Number(b.net || 0),
  };

  const SALES_METRICS = [
    ["STANDARD RATED SUPPLIES", "beforeTax"],
    ["OUTPUT TAX", "vat"],
    ["TOTAL AMOUNT INCLUDING VAT", "net"],
    ["ZERO RATED SUPPLIES", "zero"],
    ["EXEMPTED SUPPLIES", null], // always 0
  ];
  const PURCHASE_METRICS = [
    ["STANDARD RATED EXPENSES", "beforeTax"],
    ["INPUT TAX", "vat"],
    ["TOTAL AMOUNT INCLUDING VAT", "net"],
  ];

  const header = opts?.header || {};
  const hdrVendor = header.supplierVendor ?? "";
  const hdrTRN = header.supplierTRN ?? "";
  const hdrTitle = header.title ?? "CT RETURN SUMMARY";
  const hdrPeriod = header.taxPeriod ?? "";

  const netVat = A.vat - B.vat; // OUTPUT − INPUT
  let ws;

  if ((opts?.layout || "columns") === "stacked") {
    // ===== STACKED (2 columns) — exactly like your invoice module =====
    const data = [
      [`Company name: ${hdrVendor}`, ""],
      [`TRN: ${hdrTRN}`, ""],
      [hdrTitle, ""],
      [`TAX PERIOD: ${hdrPeriod}`, ""],

      ["PARTICULAR", "AMOUNT"],

      [labelA, ""],
      ...SALES_METRICS.map(([label, key]) => [label, key ? A[key] : 0]),

      ["", ""],

      [labelB, ""],
      ...PURCHASE_METRICS.map(([label, key]) => [label, key ? B[key] : 0]),

      ["", ""],

      ["NET VAT PAYABLE FOR THE PERIOD", netVat],
    ];

    ws = XLSX.utils.aoa_to_sheet(data);

    ws["!cols"] = [{ wch: 40 }, { wch: 18 }];
    ws["!merges"] = (ws["!merges"] || []).concat([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 1 } },
    ]);

    // style header rows (0..3)
    for (let r = 0; r <= 3; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[addr].s = {
        font: { bold: true, sz: r === 2 ? 12 : 11 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }

    // table header row r=4
    for (let c = 0; c < 2; c++) {
      const addr = XLSX.utils.encode_cell({ r: 4, c });
      ws[addr].s = {
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "F2F2F2" } },
      };
    }

    // numeric formatting + emphasis
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 5; r <= range.e.r; r++) {
      const partAddr = XLSX.utils.encode_cell({ r, c: 0 });
      const amtAddr = XLSX.utils.encode_cell({ r, c: 1 });
      const v = ws[partAddr]?.v;

      const isSectionHeader = v === labelA || v === labelB;
      const isSpacer = !v && !ws[amtAddr]?.v;

      if (isSectionHeader) {
        ws[partAddr].s = { ...(ws[partAddr].s || {}), font: { bold: true } };
      }

      if (!isSpacer && !isSectionHeader && typeof ws[amtAddr]?.v === "number") {
        ws[amtAddr].t = "n";
        ws[amtAddr].z = "#,##0.00";
        ws[amtAddr].s = {
          ...(ws[amtAddr].s || {}),
          alignment: {
            ...(ws[amtAddr].s?.alignment || {}),
            horizontal: "right",
          },
        };
      }
    }

    const lastRow = XLSX.utils.decode_range(ws["!ref"]).e.r;
    const netLabelAddr = XLSX.utils.encode_cell({ r: lastRow, c: 0 });
    const netAmtAddr = XLSX.utils.encode_cell({ r: lastRow, c: 1 });
    ws[netLabelAddr].s = {
      ...(ws[netLabelAddr].s || {}),
      font: { bold: true },
    };
    ws[netAmtAddr].t = "n";
    ws[netAmtAddr].z = "#,##0.00";
    ws[netAmtAddr].s = {
      ...(ws[netAmtAddr].s || {}),
      font: { bold: true },
      alignment: { horizontal: "right" },
    };
  } else {
    // (your columns layout variant — identical to invoice module)
    const rows = [
      [`SUPPLIER/VENDOR: ${hdrVendor}`, "", "", ""],
      [`SUPPLIER TRN: ${hdrTRN}`, "", "", ""],
      [hdrTitle, "", "", ""],
      [`TAX PERIOD: ${hdrPeriod}`, "", "", ""],

      ["PARTICULAR", labelA, labelB, "NET VAT (PAYABLE)"],

      ["STANDARD RATED SUPPLIES", A.beforeTax, null, null],
      ["STANDARD RATED EXPENSES", null, B.beforeTax, null],
      ["OUTPUT TAX", A.vat, null, null],
      ["INPUT TAX", null, B.vat, null],
      ["TOTAL AMOUNT INCLUDING VAT", A.net, B.net, null],
      ["ZERO RATED SUPPLIES", A.zero, null, null],
      ["EXEMPTED SUPPLIES", 0, null, null],
      ["NET VAT PAYABLE FOR THE PERIOD", null, null, A.vat - B.vat],
    ];

    ws = XLSX.utils.aoa_to_sheet(rows);

    ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 22 }];
    ws["!merges"] = (ws["!merges"] || []).concat([
      { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } },
    ]);

    for (let r = 0; r <= 3; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[addr].s = {
        font: { bold: true, sz: r === 2 ? 12 : 11 },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }

    for (let c = 0; c < 4; c++) {
      const addr = XLSX.utils.encode_cell({ r: 4, c });
      ws[addr].s = {
        font: { bold: true },
        alignment: { horizontal: "center", vertical: "center" },
        fill: { fgColor: { rgb: "F2F2F2" } },
      };
    }

    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let r = 5; r <= range.e.r; r++) {
      const labelAddr = XLSX.utils.encode_cell({ r, c: 0 });
      ws[labelAddr].s = { ...(ws[labelAddr].s || {}), font: { bold: true } };

      for (let c = 1; c <= 3; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr] || (ws[addr] = {});
        if (typeof cell.v === "number") {
          cell.t = "n";
          cell.z = "#,##0.00";
          cell.s = {
            ...(cell.s || {}),
            alignment: { ...(cell.s?.alignment || {}), horizontal: "right" },
          };
        }
      }
    }

    const last = XLSX.utils.decode_range(ws["!ref"]).e.r;
    const netLabelAddr = XLSX.utils.encode_cell({ r: last, c: 0 });
    const netAmtAddr = XLSX.utils.encode_cell({ r: last, c: 3 });
    ws[netLabelAddr].s = {
      ...(ws[netLabelAddr].s || {}),
      font: { bold: true },
    };
    ws[netAmtAddr].s = {
      ...(ws[netAmtAddr].s || {}),
      font: { bold: true },
      alignment: { horizontal: "right" },
    };
  }

  return ws;
}

// Helper function to sum a column
function sumCol(rows, col) {
  return rows.reduce((sum, row) => sum + (Number(row[col]) || 0), 0);
}

// Helper function to create a VAT summary sheet

function cleanTRN15(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d.length === 15 ? d : null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

function pickVatSummaryHeaderFromRows(salesRows = [], purchaseRows = []) {
  // Prefer Sales rows; if none, return empty header
  const from = Array.isArray(salesRows) ? salesRows : [];
  let name = "";
  let trn = "";

  // Find first sales row that has either supplier/vendor or supplier TRN
  const s = from.find(
    (r) =>
      (r &&
        typeof r["SUPPLIER/VENDOR"] === "string" &&
        r["SUPPLIER/VENDOR"].trim() !== "") ||
      cleanTRN15(r?.["SUPPLIER TRN"])
  );

  if (s) {
    name = (s["SUPPLIER/VENDOR"] || "").trim();
    trn = cleanTRN15(s["SUPPLIER TRN"]) || "";
  }

  // If there are only purchases (no sales), both should be empty
  return { supplierVendor: name, supplierTRN: trn };
}

function inferTypeFromRow(row, companyName, companyTRN) {
  // 1) Respect explicit TYPE if present
  const rawType = String(row?.TYPE || "").toLowerCase();
  if (rawType.startsWith("sale")) return "sales";
  if (rawType.startsWith("purchas")) return "purchase";

  // 2) Infer by TRN / Name
  const selfTRN = cleanTRN15(companyTRN);
  const selfName = norm(companyName);
  const supplierTRN = cleanTRN15(row?.["SUPPLIER TRN"]);
  const supplierName = norm(row?.["SUPPLIER/VENDOR"]);
  // Heuristic used in your old module: if supplier side equals self → this is SALES
  if (selfTRN && supplierTRN && selfTRN === supplierTRN) return "sales";
  if (
    selfName &&
    supplierName &&
    (supplierName === selfName ||
      supplierName.includes(selfName) ||
      selfName.includes(supplierName))
  ) {
    return "sales";
  }
  // 3) Default → purchase (missing company/TRN should become purchase)
  return "purchase";
}

function uniqueRows(rows) {
  // Prevent the same record from appearing twice across buckets
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = [
      r?.["INVOICE NUMBER"] ?? "",
      r?.DATE ?? "",
      r?.["NET AMOUNT (AED)"] ?? r?.["NET AMOUNT"] ?? "",
      r?.SOURCE ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function ensureArray(a) {
  return Array.isArray(a) ? a : [];
}

function strictSplitInvoice(invoiceData) {
  if (!invoiceData || typeof invoiceData !== "object") {
    return { uaeSalesRows: [], uaePurchaseRows: [] };
  }

  const hasExplicitSales = Object.prototype.hasOwnProperty.call(
    invoiceData,
    "uaeSalesRows"
  );
  const hasExplicitPurch = Object.prototype.hasOwnProperty.call(
    invoiceData,
    "uaePurchaseRows"
  );

  if (hasExplicitSales || hasExplicitPurch) {
    return {
      uaeSalesRows: ensureArray(invoiceData.uaeSalesRows),
      uaePurchaseRows: ensureArray(invoiceData.uaePurchaseRows),
    };
  }

  // Fallback ONLY if a typed table is provided
  const rows = ensureArray(invoiceData?.table?.rows);
  if (rows.length) {
    const sales = [];
    const purchase = [];
    for (const r of rows) {
      const t = String(r?.TYPE || "")
        .trim()
        .toLowerCase();
      if (t === "sales" || t === "sale") sales.push(r);
      else if (t === "purchase" || t === "purchases") purchase.push(r);
      // else: unknown TYPE → drop it (strict behavior)
    }
    return { uaeSalesRows: sales, uaePurchaseRows: purchase };
  }

  return { uaeSalesRows: [], uaePurchaseRows: [] };
}

// Generate combined Excel workbook
export async function generateCombinedExcel(req, res) {
  try {
    const { companyId } = req.params;
    const { bankData, invoiceData, companyName } = req.body;

    // Create new workbook
    const wb = XLSX.utils.book_new();

    // ---------- BANK (accept string[] or {key,label}[]) ----------
    if (bankData && Array.isArray(bankData.rows) && bankData.rows.length > 0) {
      const bankOrder = Array.isArray(bankData.columns)
        ? bankData.columns
          .map((c) =>
            typeof c === "string" ? c : c.key ?? c.field ?? c.accessor ?? ""
          )
          .filter(Boolean)
        : [];

      const effectiveOrder =
        bankOrder.length > 0 ? bankOrder : Object.keys(bankData.rows[0] || {}); // fallback if columns missing

      const bankSheet = sheetFromObjects(bankData.rows, effectiveOrder);
      XLSX.utils.book_append_sheet(wb, bankSheet, "Bank Statements");
    }

    if (
      bankData &&
      bankData.summary &&
      typeof bankData.summary === "object" &&
      Object.keys(bankData.summary).length > 0
    ) {
      const wsSummary = bankAccountSummarySheet(bankData.summary);
      if (wsSummary) {
        XLSX.utils.book_append_sheet(wb, wsSummary, "BankAccountSummary");
      }
    }

    // ---------- INVOICES ----------

    if (invoiceData) {
      // TRUST the strict split first
      const { uaeSalesRows, uaePurchaseRows } = strictSplitInvoice(invoiceData);

      let salesRows = ensureArray(uaeSalesRows);
      let purchaseRows = ensureArray(uaePurchaseRows);

      // optional de-mirror guard
      function areMirrored(a = [], b = []) {
        if (!a.length || !b.length) return false;
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
          if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
        }
        return true;
      }
      if (areMirrored(salesRows, purchaseRows)) {
        salesRows = []; // prefer purchases-only
      }

      // Unified sheet (optional): include only rows that actually exist
      const unified = [
        ...salesRows.map((r) => ({ TYPE: "Sales", ...r })),
        ...purchaseRows.map((r) => ({ TYPE: "Purchase", ...r })),
      ];
      if (unified.length) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(unified, [
            "TYPE",
            "DATE",
            "INVOICE NUMBER",
            "INVOICE CATEGORY",
            "SUPPLIER/VENDOR",
            "PARTY",
            "SUPPLIER TRN",
            "CUSTOMER TRN",
            "CURRENCY",
            "BEFORE TAX AMOUNT",
            "VAT",
            "NET AMOUNT",
            "BEFORE TAX (AED)",
            "VAT (AED)",
            "ZERO RATED (AED)",
            "NET AMOUNT (AED)",
            "CONFIDENCE",
            "SOURCE",
          ]),
          "UAE - Invoices"
        );
      }

      // Type-specific sheets: create ONLY if they have rows
      const salesOrder = [
        "TYPE",
        "DATE",
        "INVOICE NUMBER",
        "INVOICE CATEGORY",
        "SUPPLIER/VENDOR",
        "PARTY",
        "CUSTOMER TRN",
        "CURRENCY",
        "BEFORE TAX AMOUNT",
        "VAT",
        "NET AMOUNT",
        "BEFORE TAX (AED)",
        "VAT (AED)",
        "ZERO RATED (AED)",
        "NET AMOUNT (AED)",
        "CONFIDENCE",
        "SOURCE",
      ];

      const purchaseOrder = [
        "TYPE",
        "DATE",
        "INVOICE NUMBER",
        "INVOICE CATEGORY",
        "SUPPLIER/VENDOR",
        "PARTY",
        "SUPPLIER TRN",
        "CURRENCY",
        "BEFORE TAX AMOUNT",
        "VAT",
        "NET AMOUNT",
        "BEFORE TAX (AED)",
        "VAT (AED)",
        "ZERO RATED (AED)",
        "NET AMOUNT (AED)",
        "CONFIDENCE",
        "SOURCE",
      ];

      XLSX.utils.book_append_sheet(
        wb,
        sheetFromObjects(
          purchaseRows.map((r) => ({ TYPE: "Purchase", ...r })),
          purchaseOrder
        ),
        "UAE - Purchases"
      );

      XLSX.utils.book_append_sheet(
        wb,
        sheetFromObjects(
          salesRows.map((r) => ({ TYPE: "Sales", ...r })),
          salesOrder
        ),
        "UAE - Sales"
      );

      // Totals & VAT Summary — computed only from what exists
      if (purchaseRows.length || salesRows.length) {
        const sum = (arr, k) =>
          arr.reduce((s, r) => s + (Number(r?.[k]) || 0), 0);

        const computedPurchase = {
          beforeTax: sum(purchaseRows, "BEFORE TAX (AED)"),
          vat: sum(purchaseRows, "VAT (AED)"),
          zero: sum(purchaseRows, "ZERO RATED (AED)"),
          net: sum(purchaseRows, "NET AMOUNT (AED)"),
        };
        const computedSales = {
          beforeTax: sum(salesRows, "BEFORE TAX (AED)"),
          vat: sum(salesRows, "VAT (AED)"),
          zero: sum(salesRows, "ZERO RATED (AED)"),
          net: sum(salesRows, "NET AMOUNT (AED)"),
        };

        // Only append the totals that exist
        if (purchaseRows.length) {
          XLSX.utils.book_append_sheet(
            wb,
            summarySheet(computedPurchase),
            "Purchase Total (AED)"
          );
        }
        if (salesRows.length) {
          XLSX.utils.book_append_sheet(
            wb,
            summarySheet(computedSales),
            "Sales Total (AED)"
          );
        }

        // VAT Summary header: keep your existing behavior
        const headerForVatSummary = pickVatSummaryHeaderFromRows(
          salesRows,
          purchaseRows
        );

        XLSX.utils.book_append_sheet(
          wb,
          ctSummarySheet(
            computedSales,
            computedPurchase,
            "Sales",
            "Purchases",
            {
              layout: "stacked",
              header: {
                supplierVendor: headerForVatSummary.supplierVendor, // blank if only purchases
                supplierTRN: headerForVatSummary.supplierTRN, // blank if only purchases
                taxPeriod: "",
                title: "CT RETURN SUMMARY",
              },
            }
          ),
          "CT Summary"
        );
      }
    }

    // Generate buffer
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Set headers for download
    const filename = `${companyName || "Company"}_CT_Filing.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (error) {
    console.error("Error generating combined Excel:", error);
    res.status(500).json({ message: "Failed to generate combined Excel file" });
  }
}

// Get combined preview data
export async function getCombinedPreview(req, res) {
  try {
    const { companyId } = req.params;

    // TODO: replace mockInvoiceData with real DB fetch when ready.
    // For a purchases-only preview, keep sales empty:
    const mockInvoiceData = {
      uaeSalesRows: [], // <-- ensure empty when you expect NO sales
      uaePurchaseRows: [
        {
          DATE: "2023-01-03",
          "INVOICE NUMBER": "BILL-001",
          "SUPPLIER/VENDOR": "Vendor A",
          "BEFORE TAX (AED)": "300.00",
          "VAT (AED)": "15.00",
          "NET AMOUNT (AED)": "315.00",
        },
        {
          DATE: "2023-01-12",
          "INVOICE NUMBER": "BILL-002",
          "SUPPLIER/VENDOR": "Vendor B",
          "BEFORE TAX (AED)": "450.00",
          "VAT (AED)": "22.50",
          "NET AMOUNT (AED)": "472.50",
        },
      ],
    };

    const split = strictSplitInvoice(mockInvoiceData);

    // optional de-mirror guard
    function areMirrored(a = [], b = []) {
      if (!a.length || !b.length) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
      }
      return true;
    }

    let uaeSalesRows = split.uaeSalesRows;
    let uaePurchaseRows = split.uaePurchaseRows;

    if (areMirrored(uaeSalesRows, uaePurchaseRows)) {
      uaeSalesRows = []; // prefer purchases-only
    }

    res.json({
      companyId,
      title: "CT Filing Preview",
      downloadFileName: `Company_${companyId}_CT_Filing_Preview.xlsx`,
      bankData: {
        columns: [
          { key: "DATE", label: "Date" },
          { key: "DESCRIPTION", label: "Description" },
          { key: "DEBIT", label: "Debit" },
          { key: "CREDIT", label: "Credit" },
          { key: "BALANCE", label: "Balance" },
        ],
        rows: [],
        summary: {},
      },
      invoiceData: {
        uaeSalesRows,
        uaePurchaseRows,
        __explicitBuckets: true,
      },
    });
  } catch (error) {
    console.error("Error fetching combined preview:", error);
    res.status(500).json({ message: "Failed to fetch preview data" });
  }
}
