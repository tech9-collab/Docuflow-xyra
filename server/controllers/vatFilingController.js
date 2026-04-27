import { pool } from "../initDatabase.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import XLSX from "xlsx-js-style";

const UPLOADS_ROOT = process.env.UPLOADS_ROOT || "uploads";
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
    "INVOICE NET (AED)",
    "BANK DEBIT",
    "BANK CREDIT",
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

function bankAccountSummarySheet(summary = {}) {
  if (!summary || typeof summary !== "object") return null;

  const entries = Object.entries(summary).filter(
    ([, v]) => v !== undefined && v !== null && String(v).trim() !== "",
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

  // Body cells
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
  for (let r = 1; r <= 5; r++) {
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

function vatSummarySheet(
  a = {},
  b = {},
  labelA = "Sales",
  labelB = "Purchases",
  opts = { layout: "columns", header: {} }, // header: { supplierVendor, supplierTRN, taxPeriod, title }
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
  const hdrTitle = header.title ?? "VAT RETURN SUMMARY";
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
      ["EXEMPTED SUPPLIES", 0, 0, null],
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

function vatReturnSheetFromTotals(computedSales, computedPurchase) {
  const salesAmount = Number(computedSales.beforeTax || 0);
  const salesVat = Number(computedSales.vat || 0);
  const salesTotal = salesAmount + salesVat;

  const inputsAmount = Number(computedPurchase.beforeTax || 0);
  const inputsVat = Number(computedPurchase.vat || 0);
  const inputsTotal = inputsAmount + inputsVat;

  const outputsAmountTotal = salesAmount; // others = 0
  const outputsVatTotal = salesVat;
  const outputsGrandTotal = outputsAmountTotal + outputsVatTotal;

  const inputsAmountTotal = inputsAmount;
  const inputsVatTotal = inputsVat;
  const inputsGrandTotal = inputsAmountTotal + inputsVatTotal;

  const totalDueTax = outputsVatTotal;
  const totalRecoverableTax = inputsVatTotal;
  const vatPayable = totalDueTax - totalRecoverableTax;

  const data = [
    ["VAT ON SALES AND ALL OTHER OUTPUTS", "", "", ""],
    [
      "VAT ON SALES AND ALL OTHER OUTPUTS",
      "AMOUNT",
      "VAT AMOUNT",
      "TOTAL AMOUNT",
    ],
    ["STANDARD RATED SUPPLIES", salesAmount, salesVat, salesTotal],
    ["Reverse Charge Provisions (Supplies)", 0, 0, 0],
    [
      "ZERO RATED SUPPLIES",
      Number(computedSales.zero || 0),
      0,
      Number(computedSales.zero || 0),
    ],
    ["EXEMPTED SUPPLIES", 0, 0, 0],
    ["Goods imported into UAE", 0, 0, 0],
    ["TOTAL AMOUNT", outputsAmountTotal, outputsVatTotal, outputsGrandTotal],
    [""],
    ["VAT ON EXPENSES AND ALL OTHER INPUTS", "", "", ""],
    [
      "VAT ON EXPENSES AND ALL OTHER INPUTS",
      "AMOUNT",
      "VAT AMOUNT",
      "TOTAL AMOUNT",
    ],
    ["STANDARD RATED EXPENSES", inputsAmount, inputsVat, inputsTotal],
    ["Reverse Charge Provisions (Expenses)", 0, 0, 0],
    ["TOTAL AMOUNT", inputsAmountTotal, inputsVatTotal, inputsGrandTotal],
    ["", ""],
    ["NET VAT VALUE", "", "", ""],
    ["NET VAT VALUE", "Amount ( AED )", "", ""],
    ["Total Value of due tax for the period", totalDueTax, "", ""],
    [
      "Total Value of recoverable tax for the period",
      totalRecoverableTax,
      "",
      "",
    ],
    ["VAT PAYABLE FOR THE PERIOD", vatPayable, "", ""],
    ["FUND AVAILABLE FTA", 0, "", ""],
    ["NET VAT PAYABLE FOR THE PERIOD", vatPayable, "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths
  ws["!cols"] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];

  // Merge big section headers
  ws["!merges"] = (ws["!merges"] || []).concat([
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, // VAT on Sales
    { s: { r: 9, c: 0 }, e: { r: 9, c: 3 } }, // VAT on Expenses
    { s: { r: 15, c: 0 }, e: { r: 15, c: 3 } }, // NET VAT VALUE
  ]);

  // Style header rows
  const headerRows = [0, 1, 9, 10, 15, 16]; // 👈 added 16
  headerRows.forEach((r) => {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = {});
      cell.s = {
        ...(cell.s || {}),
        font: { ...(cell.s?.font || {}), bold: true },
        alignment: {
          ...(cell.s?.alignment || {}),
          horizontal: "center",
          vertical: "center",
          wrapText: true,
        },
        fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
      };
    }
  });

  // Numeric formatting
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 1; c <= 3; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: {
            ...(cell.s?.alignment || {}),
            horizontal: "right",
          },
        };
      }
    }
  }

  return ws;
}

function vatReturnSheetFromTotalsWithOverrides(
  computedSales,
  computedPurchase,
  overrides = {},
) {
  const readNum = (key, fallback = 0) => {
    const raw = overrides?.[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const adjustment = (key) => readNum(`${key}.adjustment`, 0);

  const salesAmount = readNum(
    "outputs.standard.amount",
    Number(computedSales.beforeTax || 0),
  );
  const salesVat = readNum(
    "outputs.standard.vat",
    Number(computedSales.vat || 0),
  );
  const salesTotal = salesAmount + salesVat;
  const reverseSalesAmount = readNum("outputs.reverseCharge.amount", 0);
  const reverseSalesVat = readNum("outputs.reverseCharge.vat", 0);
  const reverseSalesTotal = reverseSalesAmount + reverseSalesVat;
  const zeroSalesAmount = readNum(
    "outputs.zeroRated.amount",
    Number(computedSales.zero || 0),
  );
  const zeroSalesVat = readNum("outputs.zeroRated.vat", 0);
  const zeroSalesTotal = zeroSalesAmount + zeroSalesVat;
  const exemptSalesAmount = readNum("outputs.exempt.amount", 0);
  const exemptSalesVat = readNum("outputs.exempt.vat", 0);
  const exemptSalesTotal = exemptSalesAmount + exemptSalesVat;
  const goodsAmount = readNum("outputs.goodsImport.amount", 0);
  const goodsVat = readNum("outputs.goodsImport.vat", 0);
  const goodsTotal = goodsAmount + goodsVat;

  const inputsAmount = readNum(
    "inputs.standard.amount",
    Number(computedPurchase.beforeTax || 0),
  );
  const inputsVat = readNum(
    "inputs.standard.vat",
    Number(computedPurchase.vat || 0),
  );
  const inputsTotal = inputsAmount + inputsVat;
  const reverseInputsAmount = readNum("inputs.reverseCharge.amount", 0);
  const reverseInputsVat = readNum("inputs.reverseCharge.vat", 0);
  const reverseInputsTotal = reverseInputsAmount + reverseInputsVat;

  const outputsAmountTotal =
    salesAmount +
    reverseSalesAmount +
    zeroSalesAmount +
    exemptSalesAmount +
    goodsAmount;
  const outputsVatTotal =
    salesVat + reverseSalesVat + zeroSalesVat + exemptSalesVat + goodsVat;
  const outputsGrandTotal = outputsAmountTotal + outputsVatTotal;

  const inputsAmountTotal = inputsAmount + reverseInputsAmount;
  const inputsVatTotal = inputsVat + reverseInputsVat;
  const inputsGrandTotal = inputsAmountTotal + inputsVatTotal;

  const totalDueTax = outputsVatTotal;
  const totalRecoverableTax = inputsVatTotal;
  const vatPayable = totalDueTax - totalRecoverableTax;
  const ftaFund = readNum("ftaFund", 0);
  const netVatPayable = vatPayable - ftaFund;

  const data = [
    ["VAT ON SALES AND ALL OTHER OUTPUTS", "", "", "", ""],
    [
      "VAT ON SALES AND ALL OTHER OUTPUTS",
      "AMOUNT",
      "VAT AMOUNT",
      "TOTAL AMOUNT",
      "ADJUSTMENT (AED)",
    ],
    [
      "STANDARD RATED SUPPLIES",
      salesAmount,
      salesVat,
      salesTotal,
      adjustment("outputs.standard"),
    ],
    [
      "Reverse Charge Provisions (Supplies)",
      reverseSalesAmount,
      reverseSalesVat,
      reverseSalesTotal,
      adjustment("outputs.reverseCharge"),
    ],
    [
      "ZERO RATED SUPPLIES",
      zeroSalesAmount,
      zeroSalesVat,
      zeroSalesTotal,
      adjustment("outputs.zeroRated"),
    ],
    [
      "EXEMPTED SUPPLIES",
      exemptSalesAmount,
      exemptSalesVat,
      exemptSalesTotal,
      adjustment("outputs.exempt"),
    ],
    [
      "Goods imported into UAE",
      goodsAmount,
      goodsVat,
      goodsTotal,
      adjustment("outputs.goodsImport"),
    ],
    [
      "TOTAL AMOUNT",
      outputsAmountTotal,
      outputsVatTotal,
      outputsGrandTotal,
      adjustment("outputs.total"),
    ],
    [""],
    ["VAT ON EXPENSES AND ALL OTHER INPUTS", "", "", "", ""],
    [
      "VAT ON EXPENSES AND ALL OTHER INPUTS",
      "AMOUNT",
      "VAT AMOUNT",
      "TOTAL AMOUNT",
      "ADJUSTMENT (AED)",
    ],
    [
      "STANDARD RATED EXPENSES",
      inputsAmount,
      inputsVat,
      inputsTotal,
      adjustment("inputs.standard"),
    ],
    [
      "Reverse Charge Provisions (Expenses)",
      reverseInputsAmount,
      reverseInputsVat,
      reverseInputsTotal,
      adjustment("inputs.reverseCharge"),
    ],
    [
      "TOTAL AMOUNT",
      inputsAmountTotal,
      inputsVatTotal,
      inputsGrandTotal,
      adjustment("inputs.total"),
    ],
    ["", ""],
    ["NET VAT VALUE", "", "", "", ""],
    ["NET VAT VALUE", "AMOUNT (AED)", "ADJUSTMENT (AED)", "", ""],
    [
      "Total Value of due tax for the period",
      totalDueTax,
      adjustment("net.totalDueTax"),
      "",
      "",
    ],
    [
      "Total Value of recoverable tax for the period",
      totalRecoverableTax,
      adjustment("net.totalRecoverableTax"),
      "",
      "",
    ],
    [
      "VAT PAYABLE FOR THE PERIOD",
      vatPayable,
      adjustment("net.vatPayable"),
      "",
      "",
    ],
    ["FUND AVAILABLE FTA", ftaFund, adjustment("ftaFund"), "", ""],
    [
      "NET VAT PAYABLE FOR THE PERIOD",
      netVatPayable,
      adjustment("net.afterFund"),
      "",
      "",
    ],
    [
      "Do you wish to request a refund for the above amount of excess recoverable tax?",
      overrides?.refundRequest === "yes"
        ? "Yes"
        : overrides?.refundRequest === "no"
          ? "No"
          : "-",
      adjustment("refundRequest"),
      "",
      "",
    ],
    [
      "Did you apply the profit margin scheme in respect of any supplies made during the tax period?",
      overrides?.profitMarginScheme === "yes"
        ? "Yes"
        : overrides?.profitMarginScheme === "no"
          ? "No"
          : "-",
      adjustment("profitMarginScheme"),
      "",
      "",
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  ws["!cols"] = [{ wch: 52 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  ws["!merges"] = (ws["!merges"] || []).concat([
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: 4 } },
    { s: { r: 15, c: 0 }, e: { r: 15, c: 4 } },
  ]);

  const headerRows = [0, 1, 9, 10, 15, 16];
  headerRows.forEach((r) => {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = {});
      cell.s = {
        ...(cell.s || {}),
        font: { ...(cell.s?.font || {}), bold: true },
        alignment: {
          ...(cell.s?.alignment || {}),
          horizontal: "center",
          vertical: "center",
          wrapText: true,
        },
        fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } },
      };
    }
  });

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 1; c <= 4; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") {
        cell.t = "n";
        cell.z = "#,##0.00";
        cell.s = {
          ...(cell.s || {}),
          alignment: {
            ...(cell.s?.alignment || {}),
            horizontal: "right",
          },
        };
      }
    }
  }

  return ws;
}

function vatReturnTemplateSheet(computedSales = {}, computedPurchase = {}, overrides = {}) {
  const readNum = (key, fallback = 0) => {
    const raw = overrides?.[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const outputs = {
    standard: {
      amount: readNum("outputs.standard.amount", Number(computedSales.beforeTax || 0)),
      vat: readNum("outputs.standard.vat", Number(computedSales.vat || 0)),
      adjustment: readNum("outputs.standard.adjustment", 0),
    },
    reverseCharge: {
      amount: readNum("outputs.reverseCharge.amount", 0),
      vat: readNum("outputs.reverseCharge.vat", 0),
      adjustment: readNum("outputs.reverseCharge.adjustment", 0),
    },
    zeroRated: {
      amount: readNum("outputs.zeroRated.amount", Number(computedSales.zero || 0)),
      vat: readNum("outputs.zeroRated.vat", 0),
      adjustment: readNum("outputs.zeroRated.adjustment", 0),
    },
    exempt: {
      amount: readNum("outputs.exempt.amount", 0),
      vat: readNum("outputs.exempt.vat", 0),
      adjustment: readNum("outputs.exempt.adjustment", 0),
    },
    goodsImport: {
      amount: readNum("outputs.goodsImport.amount", 0),
      vat: readNum("outputs.goodsImport.vat", 0),
      adjustment: readNum("outputs.goodsImport.adjustment", 0),
    },
  };

  const inputs = {
    standard: {
      amount: readNum("inputs.standard.amount", Number(computedPurchase.beforeTax || 0)),
      vat: readNum("inputs.standard.vat", Number(computedPurchase.vat || 0)),
      adjustment: readNum("inputs.standard.adjustment", 0),
    },
    reverseCharge: {
      amount: readNum("inputs.reverseCharge.amount", 0),
      vat: readNum("inputs.reverseCharge.vat", 0),
      adjustment: readNum("inputs.reverseCharge.adjustment", 0),
    },
  };

  const outputsVatTotal =
    outputs.standard.vat +
    outputs.reverseCharge.vat +
    outputs.zeroRated.vat +
    outputs.exempt.vat +
    outputs.goodsImport.vat;
  const inputsVatTotal = inputs.standard.vat + inputs.reverseCharge.vat;
  const vatPayableForPeriod = outputsVatTotal - inputsVatTotal;
  const refundYes = overrides?.refundRequest === "yes";
  const refundNo = overrides?.refundRequest === "no";
  const marginYes = overrides?.profitMarginScheme === "yes";
  const marginNo = overrides?.profitMarginScheme === "no";

  const rows = [
    ["VAT Return", "", "", ""],
    [""],
    ["VAT on Sales and All Other Outputs", "", "", ""],
    ["Description", "Amount\n[AED]", "VAT Amount\n[AED]", "Adjustment\n[AED]"],
    ["1a    Standard rated supplies in Abu Dhabi*", outputs.standard.amount, outputs.standard.vat, outputs.standard.adjustment],
    ["1b    Standard rated supplies in Dubai*", 0, 0, 0],
    ["1c    Standard rated supplies in Sharjah*", 0, 0, 0],
    ["1d    Standard rated supplies in Ajman*", 0, 0, 0],
    ["1e    Standard rated supplies in Umm Al Quwain*", 0, 0, 0],
    ["1f    Standard rated supplies in Ras Al Khaimah*", 0, 0, 0],
    ["1g    Standard rated supplies in Fujairah*", 0, 0, 0],
    ["2    Tax Refunds provided to Tourists under the Tax Refunds for Tourists Scheme*", 0, 0, 0],
    ["3    Supplies subject to the reverse charge provisions*", outputs.reverseCharge.amount, outputs.reverseCharge.vat, outputs.reverseCharge.adjustment],
    ["4    Zero rated supplies*", outputs.zeroRated.amount, outputs.zeroRated.vat, outputs.zeroRated.adjustment],
    ["5    Exempt supplies*", outputs.exempt.amount, outputs.exempt.vat, outputs.exempt.adjustment],
    ["6    Goods imported into the UAE*", outputs.goodsImport.amount, outputs.goodsImport.vat, 0],
    ["7    Adjustments to goods imported into the UAE*", 0, 0, outputs.goodsImport.adjustment],
    ["8    Totals",
      outputs.standard.amount + outputs.reverseCharge.amount + outputs.zeroRated.amount + outputs.exempt.amount + outputs.goodsImport.amount,
      outputsVatTotal,
      readNum("outputs.total.adjustment", 0),
    ],
    [""],
    ["VAT on Expenses and All Other Inputs", "", "", ""],
    ["Description", "Amount\n[AED]", "VAT Amount\n[AED]", "Adjustment\n[AED]"],
    ["9    Standard rated expenses*", inputs.standard.amount, inputs.standard.vat, inputs.standard.adjustment],
    ["10    Supplies subject to the reverse charge provisions*", inputs.reverseCharge.amount, inputs.reverseCharge.vat, inputs.reverseCharge.adjustment],
    ["11    Totals",
      inputs.standard.amount + inputs.reverseCharge.amount,
      inputsVatTotal,
      readNum("inputs.total.adjustment", 0),
    ],
    [""],
    ["Net VAT Due", "", "", ""],
    ["12    Total value of due tax for the period", outputsVatTotal, "", ""],
    ["13    Total value of recoverable tax for the period", inputsVatTotal, "", ""],
    ["14    Payable tax for the period", vatPayableForPeriod, "", ""],
    [""],
    ["Do you wish to request a refund for the above amount of excess recoverable tax ?", "", "", ""],
    [`    ${refundYes ? "\u25c9" : "\u25ef"} Yes`, "", "", ""],
    [`    ${refundNo ? "\u25c9" : "\u25ef"} No`, "", "", ""],
    [""],
    ["Profit Margin Scheme", "", "", ""],
    ["Did you apply the profit margin scheme in respect of any supplies made during the tax period?", "", "", ""],
    [`    ${marginYes ? "\u25c9" : "\u25ef"} Yes`, "", "", ""],
    [`    ${marginNo ? "\u25c9" : "\u25ef"} No`, "", "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 78 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
  ];
  ws["!rows"] = rows.map((_, idx) => ({
    hpt: [0, 2, 19, 24, 22, 22, 22, 22, 22, 22, 22, 28, 22, 22, 22, 22, 22, 22, 10, 19, 24, 22, 22, 22, 10, 19, 22, 22, 22, 10, 28, 18, 18, 10, 19, 24, 18, 18][idx] || 22,
  }));
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    { s: { r: 19, c: 0 }, e: { r: 19, c: 3 } },
    { s: { r: 25, c: 0 }, e: { r: 25, c: 3 } },
    { s: { r: 30, c: 0 }, e: { r: 30, c: 3 } },
    { s: { r: 34, c: 0 }, e: { r: 34, c: 3 } },
    { s: { r: 35, c: 0 }, e: { r: 35, c: 3 } },
  ];

  const range = XLSX.utils.decode_range(ws["!ref"]);
  const titleRows = new Set([0]);
  const sectionRows = new Set([2, 19, 25, 34]);
  const headerRows = new Set([3, 20]);
  const questionRows = new Set([30, 35]);
  const optionRows = new Set([31, 32, 36, 37]);
  const boxedPanelRows = new Set([30, 31, 32, 35, 36, 37]);
  const numericRows = new Set([
    4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    21, 22, 23, 26, 27, 28,
  ]);

  const thinGray = { style: "thin", color: { rgb: "BFBFBF" } };
  const strongBlue = { style: "thin", color: { rgb: "4472C4" } };
  const darkLine = { style: "medium", color: { rgb: "000000" } };

  for (let r = 0; r <= range.e.r; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] || (ws[addr] = { t: "s", v: "" });
      const isNumericColumn = c > 0;
      const isNumericTemplateRow = numericRows.has(r);

      cell.s = {
        ...(cell.s || {}),
        font: {
          ...(cell.s?.font || {}),
          name: "Arial",
          sz: titleRows.has(r) ? 12 : 10,
          bold: titleRows.has(r) || sectionRows.has(r) || headerRows.has(r) || questionRows.has(r),
        },
        alignment: {
          ...(cell.s?.alignment || {}),
          vertical: "center",
          wrapText: true,
          horizontal:
            titleRows.has(r)
              ? "center"
              : headerRows.has(r)
                ? "center"
                : isNumericColumn
                  ? "right"
                  : "left",
        },
        border: {
          top:
            titleRows.has(r) || sectionRows.has(r)
              ? darkLine
              : boxedPanelRows.has(r) && (r === 30 || r === 35)
                ? darkLine
                : thinGray,
          bottom:
            titleRows.has(r) || sectionRows.has(r)
              ? darkLine
              : boxedPanelRows.has(r) && (r === 32 || r === 37)
                ? darkLine
                : thinGray,
          left:
            boxedPanelRows.has(r)
              ? darkLine
              : (headerRows.has(r) || (isNumericTemplateRow && c >= 0))
                ? (isNumericColumn ? strongBlue : thinGray)
                : thinGray,
          right:
            boxedPanelRows.has(r)
              ? darkLine
              : (headerRows.has(r) || (isNumericTemplateRow && c >= 0))
                ? (isNumericColumn ? strongBlue : thinGray)
                : thinGray,
        },
        fill:
          headerRows.has(r) || boxedPanelRows.has(r)
            ? { patternType: "solid", fgColor: { rgb: "E7E6E6" } }
            : undefined,
      };

      if (isNumericTemplateRow && isNumericColumn) {
        if (typeof cell.v !== "number") {
          cell.t = "n";
          cell.v = 0;
        }
        cell.z = "#,##0.00";
      }

      if ([26, 27, 28].includes(r) && c > 1) {
        cell.v = "";
        cell.t = "s";
      }

      if ([31, 32, 36, 37].includes(r) && c > 0) {
        cell.v = "";
        cell.t = "s";
      }

      if (optionRows.has(r) && c === 0) {
        cell.s = {
          ...cell.s,
          font: { ...(cell.s?.font || {}), bold: false, name: "Arial", sz: 10 },
          alignment: { ...(cell.s?.alignment || {}), horizontal: "left" },
        };
      }

      if (questionRows.has(r) && c === 0) {
        cell.s = {
          ...cell.s,
          font: { ...(cell.s?.font || {}), bold: true, name: "Arial", sz: 10 },
        };
      }
    }
  }

  ws["!protect"] = {
    password: "xyrabooks",
    selectLockedCells: true,
    selectUnlockedCells: false,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
    objects: true,
    scenarios: true,
  };

  return ws;
}

export async function downloadVatReturnTemplate(req, res) {
  try {
    const {
      invoiceData,
      salesTotal: editedSalesTotal,
      purchaseTotal: editedPurchaseTotal,
      vatReturnOverrides,
    } = req.body || {};

    const { uaeSalesRows, uaePurchaseRows } = strictSplitInvoice(invoiceData || {});

    let computedSales = totalsFromUiRows(uaeSalesRows);
    let computedPurchase = totalsFromUiRows(uaePurchaseRows);

    if (Array.isArray(editedSalesTotal) && editedSalesTotal.length) {
      computedSales = totalsFromMetricRows(editedSalesTotal, "sales");
    }
    if (Array.isArray(editedPurchaseTotal) && editedPurchaseTotal.length) {
      computedPurchase = totalsFromMetricRows(editedPurchaseTotal, "purchase");
    }

    const wb = XLSX.utils.book_new();
    const ws = vatReturnTemplateSheet(
      computedSales,
      computedPurchase,
      vatReturnOverrides || {},
    );
    XLSX.utils.book_append_sheet(wb, ws, "Vat Return Template");

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="VAT_Return_Template.xlsx"',
    );
    res.send(buf);
  } catch (error) {
    console.error("Error generating VAT Return template:", error);
    res.status(500).json({ message: "Failed to download VAT Return template" });
  }
}
// ---------- Bank Reconciliation helpers Start----------

// parse "1,234.50" / 1234.5 / "  " → number or null
function parseAmount(val) {
  if (val === null || val === undefined) return null;

  // Already a number
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : null;
  }

  // String cleaning
  let s = String(val).trim();
  if (!s) return null;

  // Remove commas and whitespace
  s = s.replace(/,/g, "").replace(/\s+/g, "");

  // Strip everything except digits, dot, +, -
  s = s.replace(/[^0-9.+-]/g, "");
  if (!s) return null;

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Normalize bank rows → one object per row with debit/credit & basic info
function normalizeBankRowsForRecon(bankData) {
  const rawRows = Array.isArray(bankData?.rows) ? bankData.rows : [];
  if (!rawRows.length) return { rows: [] };

  // Try to guess header keys
  const sample = rawRows[0] || {};
  const keys =
    bankData.headers && bankData.headers.length
      ? bankData.headers
      : Object.keys(sample);

  let creditKey = null;
  let debitKey = null;
  let amountKey = null;
  let balanceKey = null;
  let dateKey = null;
  let refKey = null;
  let descKey = null;

  for (const k of keys) {
    const lower = String(k).toLowerCase();

    if (!creditKey && lower.includes("credit")) creditKey = k;
    if (!debitKey && lower.includes("debit")) debitKey = k;

    if (!amountKey && lower.includes("amount") && !lower.includes("balance")) {
      // catches "Amount (Incl. VAT)"
      amountKey = k;
    }

    if (!balanceKey && lower.includes("balance")) balanceKey = k;
    if (!dateKey && lower.includes("date")) dateKey = k;
    if (!refKey && lower.includes("reference")) refKey = k;

    if (
      !descKey &&
      (lower.includes("description") || lower.includes("narration"))
    ) {
      descKey = k;
    }
  }

  const rows = rawRows
    .map((row, idx) => {
      // ✅ MAKE THEM MUTABLE
      let credit = creditKey ? parseAmount(row[creditKey]) : null;
      let debit = debitKey ? parseAmount(row[debitKey]) : null;

      // For banks like Wio with only "Amount (Incl. VAT)"
      if (!creditKey && !debitKey && amountKey) {
        const amt = parseAmount(row[amountKey]);

        if (amt != null && amt !== 0) {
          // "-" means DEBIT, no "-" means CREDIT
          if (amt < 0) {
            debit = amt; // negative is fine; we use Math.abs later
          } else {
            credit = amt;
          }
        }
      }

      return {
        index: idx,
        date: dateKey ? row[dateKey] || "" : "",
        description: descKey ? row[descKey] || "" : "",
        debit,
        credit,
        balance: balanceKey ? parseAmount(row[balanceKey]) : null,
        ref: refKey ? row[refKey] || "" : "",
      };
    })
    // Optional but useful: drop non-money rows (pure headers)
    .filter((r) => r.debit != null || r.credit != null);

  return { rows };
}

function normalizeRowKeyToken(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function readRowValueByAliases(row, aliases = []) {
  if (!row || typeof row !== "object") return undefined;
  const normalizedToActual = new Map();
  Object.keys(row).forEach((k) => {
    normalizedToActual.set(normalizeRowKeyToken(k), k);
  });
  for (const alias of aliases) {
    const actual = normalizedToActual.get(normalizeRowKeyToken(alias));
    if (actual !== undefined) return row[actual];
  }
  return undefined;
}

function normalizeValueToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isBankModeValue(value) {
  const token = normalizeValueToken(value);
  if (!token) return false;
  if (token === "bank" || token === "banktransfer" || token === "wiretransfer")
    return true;
  return token.includes("bank");
}

function isPaidStatusValue(value) {
  const token = normalizeValueToken(value);
  if (!token) return false;
  if (
    token.startsWith("unpaid") ||
    token.startsWith("pending") ||
    token.startsWith("partiallypaid")
  ) {
    return false;
  }
  if (
    token === "paid" ||
    token.startsWith("paid") ||
    token === "fullypaid" ||
    token === "settled" ||
    token === "completed" ||
    token === "received"
  ) {
    return true;
  }
  if (token === "unpaid" || token === "partiallypaid" || token === "pending") {
    return false;
  }
  return false;
}

const PAYMENT_MODE_ALIASES = [
  "PAYMENT MODE",
  "PAYMENT_MODE",
  "MODE OF PAYMENT",
  "PAYMENT METHOD",
  "PAYMENT TYPE",
];

const PAYMENT_STATUS_ALIASES = [
  "PAYMENT STATUS",
  "PAYMENT_STATUS",
  "INVOICE STATUS",
  "PAYMENT STATE",
];

function rowHasPaymentMeta(row) {
  const hasMode =
    readRowValueByAliases(row, PAYMENT_MODE_ALIASES) !== undefined;
  const hasStatus =
    readRowValueByAliases(row, PAYMENT_STATUS_ALIASES) !== undefined;
  return hasMode || hasStatus;
}

function isReconEligibleInvoiceRow(row) {
  const paymentMode = readRowValueByAliases(row, PAYMENT_MODE_ALIASES);
  const paymentStatus = readRowValueByAliases(row, PAYMENT_STATUS_ALIASES);
  return isBankModeValue(paymentMode) && isPaidStatusValue(paymentStatus);
}

// Normalize invoice rows for reconciliation
function buildInvoiceReconRows(invoiceRows = [], typeLabel = "Sales") {
  const enforcePaymentFilter = (invoiceRows || []).some(rowHasPaymentMeta);
  const out = [];
  invoiceRows.forEach((r, idx) => {
    if (enforcePaymentFilter && !isReconEligibleInvoiceRow(r)) return;

    const net = parseAmount(
      r["NET AMOUNT (AED)"] != null ? r["NET AMOUNT (AED)"] : r["NET AMOUNT"],
    );
    if (net == null || !Number.isFinite(net) || net === 0) return;

    out.push({
      index: idx,
      type: typeLabel, // "Sales" / "Purchase"
      net,
      date: r.DATE ?? null,
      number: r["INVOICE NUMBER"] ?? "",
      party: r["SUPPLIER/VENDOR"] ?? r.PARTY ?? "",
      raw: r,
    });
  });
  return out;
}

// Match invoices to bank rows by amount:
// mode = "sales" → use bank.credit, "purchase" → bank.debit
function matchInvoicesToBank(invoices, bankRows, mode, usedBankIndices) {
  const matches = [];
  const byAmount = new Map();

  // Build lookup by ABS(bank amount)
  for (const b of bankRows) {
    const rawAmt = mode === "sales" ? b.credit : b.debit;
    if (rawAmt == null || !Number.isFinite(rawAmt) || rawAmt === 0) continue;

    const amt = Math.abs(rawAmt); // <-- IMPORTANT: ignore sign
    const key = amt.toFixed(2);

    if (!byAmount.has(key)) byAmount.set(key, []);
    byAmount.get(key).push(b);
  }

  // For each invoice, look for same ABS amount
  for (const inv of invoices) {
    if (inv.net == null || !Number.isFinite(inv.net) || inv.net === 0) continue;

    const key = Math.abs(inv.net).toFixed(2);
    const list = byAmount.get(key);
    if (!list || !list.length) continue;

    // Avoid reusing the same bank line twice
    const bank = list.find((b) => !usedBankIndices.has(b.index));
    if (!bank) continue;

    usedBankIndices.add(bank.index);
    matches.push({ invoice: inv, bank });
  }

  return matches;
}

function buildBankReconciliationSheet(bankData, salesRows, purchaseRows) {
  const normBank = normalizeBankRowsForRecon(bankData);
  if (!normBank || !normBank.rows.length) return null;

  const salesInvoices = buildInvoiceReconRows(salesRows, "Sales");
  const purchaseInvoices = buildInvoiceReconRows(purchaseRows, "Purchase");

  if (!salesInvoices.length && !purchaseInvoices.length) return null;

  const usedBank = new Set();

  // 1) Matched section
  const salesMatches = matchInvoicesToBank(
    salesInvoices,
    normBank.rows,
    "sales",
    usedBank,
  );

  const purchaseMatches = matchInvoicesToBank(
    purchaseInvoices,
    normBank.rows,
    "purchase",
    usedBank,
  );

  const order = [
    "MATCH TYPE",
    "INVOICE TYPE",
    "INVOICE DATE",
    "INVOICE NUMBER",
    "INVOICE PARTY",
    "INVOICE NET (AED)",
    "BANK DATE",
    "BANK DESCRIPTION",
    "BANK DEBIT",
    "BANK CREDIT",
  ];

  const rows = [];

  // Track which invoice indices were matched
  const matchedSalesIdx = new Set();
  const matchedPurchaseIdx = new Set();

  // --- Matched sales ---
  for (const m of salesMatches) {
    matchedSalesIdx.add(m.invoice.index);
    rows.push({
      "MATCH TYPE": "Sales receipt",
      "INVOICE TYPE": m.invoice.type,
      "INVOICE DATE": m.invoice.date || "",
      "INVOICE NUMBER": m.invoice.number || "",
      "INVOICE PARTY": m.invoice.party || "",
      "INVOICE NET (AED)": m.invoice.net,
      "BANK DATE": m.bank.date || "",
      "BANK DESCRIPTION": m.bank.description || "",
      "BANK DEBIT": m.bank.debit,
      "BANK CREDIT": m.bank.credit,
    });
  }

  // --- Matched purchases ---
  for (const m of purchaseMatches) {
    matchedPurchaseIdx.add(m.invoice.index);
    rows.push({
      "MATCH TYPE": "Purchase payment",
      "INVOICE TYPE": m.invoice.type,
      "INVOICE DATE": m.invoice.date || "",
      "INVOICE NUMBER": m.invoice.number || "",
      "INVOICE PARTY": m.invoice.party || "",
      "INVOICE NET (AED)": m.invoice.net,
      "BANK DATE": m.bank.date || "",
      "BANK DESCRIPTION": m.bank.description || "",
      "BANK DEBIT": m.bank.debit,
      "BANK CREDIT": m.bank.credit,
    });
  }

  // 2) Unmatched invoices (sales + purchases)
  for (const inv of salesInvoices) {
    if (matchedSalesIdx.has(inv.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched invoice",
      "INVOICE TYPE": inv.type,
      "INVOICE DATE": inv.date || "",
      "INVOICE NUMBER": inv.number || "",
      "INVOICE PARTY": inv.party || "",
      "INVOICE NET (AED)": inv.net,
      "BANK DATE": "",
      "BANK DESCRIPTION": "",
      "BANK DEBIT": null,
      "BANK CREDIT": null,
    });
  }

  for (const inv of purchaseInvoices) {
    if (matchedPurchaseIdx.has(inv.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched invoice",
      "INVOICE TYPE": inv.type,
      "INVOICE DATE": inv.date || "",
      "INVOICE NUMBER": inv.number || "",
      "INVOICE PARTY": inv.party || "",
      "INVOICE NET (AED)": inv.net,
      "BANK DATE": "",
      "BANK DESCRIPTION": "",
      "BANK DEBIT": null,
      "BANK CREDIT": null,
    });
  }

  // 3) Unmatched bank transactions
  for (const b of normBank.rows) {
    if (usedBank.has(b.index)) continue;
    rows.push({
      "MATCH TYPE": "Unmatched bank transaction",
      "INVOICE TYPE": "",
      "INVOICE DATE": "",
      "INVOICE NUMBER": "",
      "INVOICE PARTY": "",
      "INVOICE NET (AED)": null,
      "BANK DATE": b.date || "",
      "BANK DESCRIPTION": b.description || "",
      "BANK DEBIT": b.debit,
      "BANK CREDIT": b.credit,
    });
  }

  // Build sheet with generic helper
  const ws = sheetFromObjects(rows, order);

  return ws;
}

// ---------- Bank Reconciliation helpers End  ----------

// Helper function to create a VAT summary sheet
function cleanTRN15(s) {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d.length === 15 ? d : null;
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
      cleanTRN15(r?.["SUPPLIER TRN"]),
  );

  if (s) {
    name = (s["SUPPLIER/VENDOR"] || "").trim();
    trn = cleanTRN15(s["SUPPLIER TRN"]) || "";
  }

  // If there are only purchases (no sales), both should be empty
  return { supplierVendor: name, supplierTRN: trn };
}

function ensureArray(a) {
  return Array.isArray(a) ? a : [];
}

function uniqueRows(rows = []) {
  const normalizeRowToken = (v) =>
    String(v ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const confidenceScore = (row) => {
    const n = Number(String(row?.CONFIDENCE ?? "").replace(/%/g, ""));
    return Number.isFinite(n) ? n : -1;
  };
  const invoiceRowKey = (row) =>
    [
      row?.SOURCE,
      row?.DATE,
      row?.["INVOICE NUMBER"],
      row?.["SUPPLIER/VENDOR"],
      row?.PARTY,
      row?.["SUPPLIER TRN"],
      row?.["CUSTOMER TRN"],
      row?.CURRENCY,
      row?.["BEFORE TAX AMOUNT"],
      row?.VAT,
      row?.["NET AMOUNT"],
      row?.["BEFORE TAX (AED)"],
      row?.["VAT (AED)"],
      row?.["ZERO RATED (AED)"],
      row?.["NET AMOUNT (AED)"],
      row?.["PLACE OF SUPPLY"],
    ]
      .map(normalizeRowToken)
      .join("|");

  const byKey = new Map();
  for (const row of ensureArray(rows)) {
    if (!row || typeof row !== "object") continue;
    const key = invoiceRowKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, row);
      continue;
    }
    const prev = byKey.get(key);
    if (confidenceScore(row) > confidenceScore(prev)) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

function strictSplitInvoice(invoiceData) {
  if (!invoiceData || typeof invoiceData !== "object") {
    return { uaeSalesRows: [], uaePurchaseRows: [], uaeOtherRows: [], placeOfSupplyRows: [] };
  }

  const hasExplicitSales = Object.prototype.hasOwnProperty.call(
    invoiceData,
    "uaeSalesRows",
  );
  const hasExplicitPurch = Object.prototype.hasOwnProperty.call(
    invoiceData,
    "uaePurchaseRows",
  );
  const hasExplicitOthers =
    Object.prototype.hasOwnProperty.call(invoiceData, "othersRows") ||
    Object.prototype.hasOwnProperty.call(invoiceData, "uaeOtherRows");
  const hasExplicitPOS = Object.prototype.hasOwnProperty.call(invoiceData, "placeOfSupplyRows");

  if (hasExplicitSales || hasExplicitPurch || hasExplicitOthers || hasExplicitPOS) {
    return {
      uaeSalesRows: uniqueRows(ensureArray(invoiceData.uaeSalesRows)),
      uaePurchaseRows: uniqueRows(ensureArray(invoiceData.uaePurchaseRows)),
      uaeOtherRows: uniqueRows([
        ...ensureArray(invoiceData.othersRows),
        ...ensureArray(invoiceData.uaeOtherRows),
      ]),
      placeOfSupplyRows: uniqueRows(ensureArray(invoiceData.placeOfSupplyRows)),
    };
  }

  // Fallback from unified table rows: preserve unknown TYPE rows as Others.
  const rows = ensureArray(invoiceData?.table?.rows);
  if (rows.length) {
    const sales = [];
    const purchase = [];
    const others = [];
    for (const r of rows) {
      const t = String(r?.TYPE || "")
        .trim()
        .toLowerCase();
      if (t === "sales" || t === "sale") sales.push(r);
      else if (t === "purchase" || t === "purchases") purchase.push(r);
      else others.push(r);
    }
    return {
      uaeSalesRows: uniqueRows(sales),
      uaePurchaseRows: uniqueRows(purchase),
      uaeOtherRows: uniqueRows(others),
      placeOfSupplyRows: [],
    };
  }

  return { uaeSalesRows: [], uaePurchaseRows: [], uaeOtherRows: [], placeOfSupplyRows: [] };
}

function totalsFromUiRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { beforeTax: 0, vat: 0, zero: 0, net: 0 };
  }

  const sum = (key) =>
    rows.reduce((acc, r) => acc + (Number(r?.[key]) || 0), 0);

  return {
    beforeTax: sum("BEFORE TAX (AED)"),
    vat: sum("VAT (AED)"),
    zero: sum("ZERO RATED (AED)"),
    net: sum("NET AMOUNT (AED)"),
  };
}

function totalsFromMetricRows(metricRows = [], kind = "sales") {
  const get = (name) => {
    const target = String(name).replace(/[\s_]/g, "").toUpperCase();
    const row = (metricRows || []).find(
      (r) =>
        String(r?.METRIC || "")
          .replace(/[\s_]/g, "")
          .toUpperCase() === target,
    );
    const n = Number(row?.AMOUNT || 0);
    return Number.isFinite(n) ? n : 0;
  };

  if (kind === "sales") {
    const beforeTax =
      get("STANDARDRATEDSUPPLIES") || get("STANDARD RATED SUPPLIES");
    const vat = get("OUTPUTTAX") || get("OUTPUT TAX");
    const zero = get("ZERORATEDSUPPLIES") || get("ZERO RATED SUPPLIES");
    const net = get("TOTALAMOUNTINCLUDINGVAT") || beforeTax + vat;
    return { beforeTax, vat, zero, net };
  }

  // purchase
  const beforeTax =
    get("STANDARDRATEDEXPENSES") || get("STANDARD RATED EXPENSES");
  const vat = get("INPUTTAX") || get("INPUT TAX");
  const zero = get("ZERORATEDEXPENSES") || 0;
  const net = get("TOTALAMOUNTINCLUDINGVAT") || beforeTax + vat;
  return { beforeTax, vat, zero, net };
}

// Generate combined Excel workbook
export async function generateCombinedExcel(req, res) {
  try {
    const { companyId } = req.params;
    const {
      bankData,
      invoiceData,
      companyName,
      salesTotal: editedSalesTotal,
      purchaseTotal: editedPurchaseTotal,
      vatSummary: editedVatSummary,
      bankReconData, // <-- edited reconciliation from UI
      vatReturnOverrides, // <-- NEW: edited VAT Return from UI (if you want to use later)
    } = req.body;

    // Create new workbook
    const wb = XLSX.utils.book_new();

    // ---------- BANK (accept string[] or {key,label}[]) ----------
    if (bankData && Array.isArray(bankData.rows) && bankData.rows.length > 0) {
      const bankOrder = Array.isArray(bankData.columns)
        ? bankData.columns
          .map((c) =>
            typeof c === "string"
              ? c
              : (c.key ?? c.field ?? c.accessor ?? ""),
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
      const { uaeSalesRows, uaePurchaseRows, uaeOtherRows, placeOfSupplyRows: uaePOSRows } =
        strictSplitInvoice(invoiceData);
      const othersRows = ensureArray(uaeOtherRows);
      const placeOfSupplyRows = ensureArray(uaePOSRows);

      let salesRows = ensureArray(uaeSalesRows);
      let purchaseRows = ensureArray(uaePurchaseRows);

      // Keep both buckets as provided to avoid silent transaction drops.

      // Unified sheet (optional): include only rows that actually exist
      const unified = [
        ...salesRows.map((r) => ({ TYPE: "Sales", ...r })),
        ...purchaseRows.map((r) => ({ TYPE: "Purchase", ...r })),
        ...othersRows.map((r) => ({ TYPE: "Other", ...r })),
        ...placeOfSupplyRows.map((r) => ({ TYPE: "Place of Supply", ...r })),
      ];
      if (unified.length) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(
            unified,
            [
              "TYPE",
              "DATE",
              "INVOICE NUMBER",
              "INVOICE CATEGORY",
              "SUPPLIER/VENDOR",
              "PARTY",
              "SUPPLIER TRN",
              "CUSTOMER TRN",
              "PLACE OF SUPPLY",
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
            ].filter((k) => k !== "SOURCE_URL" && k !== "SOURCE_TYPE"),
          ),
          "UAE - Invoices",
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
        "PLACE OF SUPPLY",
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
        "PLACE OF SUPPLY",
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

      if (purchaseRows.length) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(
            purchaseRows.map((r) => ({ TYPE: "Purchase", ...r })),
            purchaseOrder,
          ),
          "UAE - Purchases",
        );
      }

      if (salesRows.length) {
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(
            salesRows.map((r) => ({ TYPE: "Sales", ...r })),
            salesOrder,
          ),
          "UAE - Sales",
        );
      }

      if (othersRows.length) {
        const sampleKeys = Object.keys(othersRows[0] || {});
        const othersOrder = sampleKeys.filter(
          (k) =>
            String(k).toUpperCase() !== "SOURCE_URL" &&
            String(k).toUpperCase() !== "SOURCE_TYPE",
        );
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(othersRows, othersOrder),
          "Others",
        );
      }

      if (placeOfSupplyRows.length) {
        const sampleKeys = Object.keys(placeOfSupplyRows[0] || {});
        const posOrder = sampleKeys.filter(
          (k) =>
            String(k).toUpperCase() !== "SOURCE_URL" &&
            String(k).toUpperCase() !== "SOURCE_TYPE",
        );
        XLSX.utils.book_append_sheet(
          wb,
          sheetFromObjects(placeOfSupplyRows, posOrder),
          "Place of Supply",
        );
      }

      // Totals & VAT Summary — computed only from what exists
      if (purchaseRows.length || salesRows.length) {
        const sum = (arr, k) =>
          arr.reduce((s, r) => s + (Number(r?.[k]) || 0), 0);

        const computedPurchaseFromInvoices = {
          beforeTax: sum(purchaseRows, "BEFORE TAX (AED)"),
          vat: sum(purchaseRows, "VAT (AED)"),
          zero: sum(purchaseRows, "ZERO RATED (AED)"),
          net: sum(purchaseRows, "NET AMOUNT (AED)"),
        };
        const computedSalesFromInvoices = {
          beforeTax: sum(salesRows, "BEFORE TAX (AED)"),
          vat: sum(salesRows, "VAT (AED)"),
          zero: sum(salesRows, "ZERO RATED (AED)"),
          net: sum(salesRows, "NET AMOUNT (AED)"),
        };

        // ✅ final totals used EVERYWHERE (Sales Total, Purchase Total, Vat Summary, Vat Return)
        let computedPurchase = computedPurchaseFromInvoices;
        let computedSales = computedSalesFromInvoices;

        if (Array.isArray(editedPurchaseTotal) && editedPurchaseTotal.length) {
          computedPurchase = totalsFromMetricRows(
            editedPurchaseTotal,
            "purchase",
          );
        }
        if (Array.isArray(editedSalesTotal) && editedSalesTotal.length) {
          computedSales = totalsFromMetricRows(editedSalesTotal, "sales");
        }

        // Only append the totals that exist
        // ----- Purchase Total sheet -----
        if (Array.isArray(editedPurchaseTotal) && editedPurchaseTotal.length) {
          const order = Object.keys(editedPurchaseTotal[0]);
          XLSX.utils.book_append_sheet(
            wb,
            sheetFromObjects(editedPurchaseTotal, order),
            "Purchase Total (AED)",
          );
        } else if (purchaseRows.length) {
          XLSX.utils.book_append_sheet(
            wb,
            summarySheet(computedPurchase),
            "Purchase Total (AED)",
          );
        }

        // ----- Sales Total sheet -----
        if (Array.isArray(editedSalesTotal) && editedSalesTotal.length) {
          const order = Object.keys(editedSalesTotal[0]);
          XLSX.utils.book_append_sheet(
            wb,
            sheetFromObjects(editedSalesTotal, order),
            "Sales Total (AED)",
          );
        } else if (salesRows.length) {
          XLSX.utils.book_append_sheet(
            wb,
            summarySheet(computedSales),
            "Sales Total (AED)",
          );
        }
        // VAT Summary header: keep your existing behavior
        const headerForVatSummary = pickVatSummaryHeaderFromRows(
          salesRows,
          purchaseRows,
        );

        if (Array.isArray(editedVatSummary) && editedVatSummary.length) {
          // Directly export the edited VAT Summary table
          const order = Object.keys(editedVatSummary[0]);
          XLSX.utils.book_append_sheet(
            wb,
            sheetFromObjects(editedVatSummary, order),
            "Vat Summary",
          );
        } else {
          // old behavior – computed from invoices
          XLSX.utils.book_append_sheet(
            wb,
            vatSummarySheet(
              computedSales,
              computedPurchase,
              "Sales",
              "Purchases",
              {
                layout: "stacked",
                header: {
                  supplierVendor: headerForVatSummary.supplierVendor,
                  supplierTRN: headerForVatSummary.supplierTRN,
                  taxPeriod: "",
                  title: "VAT RETURN SUMMARY",
                },
              },
            ),
            "Vat Summary",
          );
        }

        const vatReturnSheet = vatReturnSheetFromTotalsWithOverrides(
          computedSales,
          computedPurchase,
          vatReturnOverrides,
        );
        XLSX.utils.book_append_sheet(wb, vatReturnSheet, "Vat Return");

        // ---------- NEW: Bank Reconciliation sheet ----------
        if (
          bankReconData &&
          Array.isArray(bankReconData.rows) &&
          bankReconData.rows.length
        ) {
          // 👇 Use the EXACT edited reconciliation rows from UI
          const reconOrder = Array.isArray(bankReconData.columns)
            ? bankReconData.columns
              .map((c) =>
                typeof c === "string"
                  ? c
                  : (c.key ?? c.field ?? c.accessor ?? ""),
              )
              .filter(Boolean)
            : Object.keys(bankReconData.rows[0]);

          const reconSheet = sheetFromObjects(bankReconData.rows, reconOrder);
          XLSX.utils.book_append_sheet(wb, reconSheet, "Bank Reconciliation");
        } else if (
          bankData &&
          Array.isArray(bankData.rows) &&
          bankData.rows.length > 0
        ) {
          // fallback: auto-match logic
          try {
            const reconSheet = buildBankReconciliationSheet(
              bankData,
              salesRows,
              purchaseRows,
            );
            if (reconSheet) {
              XLSX.utils.book_append_sheet(
                wb,
                reconSheet,
                "Bank Reconciliation",
              );
            }
          } catch (e) {
            console.warn("Bank reconciliation skipped:", e?.message || e);
          }
        }
        // ---------- /Bank Reconciliation sheet ----------
      }
    }

    // Generate buffer
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Set headers for download
    const filename = `${companyName || "Company"}_VAT_Filing.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (error) {
    console.error("Error generating combined Excel:", error);
    res.status(500).json({ message: "Failed to generate combined Excel file" });
  }
}

// ===== FTA Audit Filing helpers =====
const FTA_MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ftaParseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const str = String(value).trim();
  if (!str) return null;

  const dmy = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10);
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (day > 12 && month <= 12) {
      return new Date(year, month - 1, day);
    }
    if (month > 12 && day <= 12) {
      return new Date(year, day - 1, month);
    }
    return new Date(year, month - 1, day);
  }
  const ymd = str.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (ymd) {
    return new Date(
      parseInt(ymd[1], 10),
      parseInt(ymd[2], 10) - 1,
      parseInt(ymd[3], 10)
    );
  }
  const fallback = new Date(str);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function ftaFormatDmy(value) {
  const d = ftaParseDate(value);
  if (!d) return value ? String(value) : "";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function ftaFormatHeaderDate(value) {
  const d = ftaParseDate(value);
  if (!d) return value ? String(value) : "";
  const day = String(d.getDate()).padStart(2, "0");
  const mon = FTA_MONTHS_SHORT[d.getMonth()];
  const yy = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yy}`;
}

function ftaNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const cleaned = typeof value === "number"
    ? value
    : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(cleaned) ? cleaned : 0;
}

function ftaSanitizeSheetName(raw) {
  const fallback = "FTAVATAuditFile";
  const cleaned = String(raw || "")
    .replace(/[\\\/?*\[\]:]/g, "")
    .trim();
  const candidate = cleaned ? `FTAVATAuditFile_${cleaned}` : fallback;
  return candidate.slice(0, 31);
}

const FTA_HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "1F2937" } },
  alignment: { horizontal: "left", vertical: "center", wrapText: true },
};

const FTA_TOTAL_LABEL_STYLE = {
  font: { bold: true },
  alignment: { horizontal: "left", vertical: "center" },
};

const FTA_TOTAL_VALUE_STYLE = {
  font: { bold: true },
  numFmt: "#,##0.00",
  alignment: { horizontal: "right", vertical: "center" },
};

const FTA_NUMBER_STYLE = {
  numFmt: "#,##0.00",
  alignment: { horizontal: "right", vertical: "center" },
};

function ftaWriteRow(ws, rowIndex, columnLetters, values, style) {
  values.forEach((val, idx) => {
    const cellAddress = `${columnLetters[idx]}${rowIndex}`;
    const cell = { v: val };
    if (typeof val === "number") {
      cell.t = "n";
    } else if (val === null || val === undefined) {
      cell.v = "";
      cell.t = "s";
    } else {
      cell.t = "s";
      cell.v = String(val);
    }
    if (style) cell.s = style;
    ws[cellAddress] = cell;
  });
}

function ftaBuildLineRows(rows, kind) {
  const isSales = kind === "sales";
  const supplyKey = isSales ? "SupplyValueAED" : "PurchaseValueAED";
  const fcyKey = isSales ? "SupplyFCY" : "PurchaseFCY";
  const countryKey = isSales ? "CustomerCountry" : "SupplierCountry";
  const trnKey = isSales ? "CustomerTIN/TRN" : "SupplierTRN/TIN";
  const trnSourceField = isSales ? "CUSTOMER TRN" : "SUPPLIER TRN";
  const partyField = isSales ? "PARTY" : "SUPPLIER/VENDOR";
  const fallbackProductName = isSales ? "Product Sales" : "Uncategorized Expense";

  const lineCounts = new Map();
  const out = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const invoiceNo = row["INVOICE NUMBER"] || row["Invoice Number"] || "";
    const date = row.DATE || row["Invoice Date"] || row["INVOICE DATE"] || "";
    const country = row[countryKey] || row.COUNTRY || row["PLACE OF SUPPLY"] || "";
    const trn = row[trnSourceField] || "";
    const productName = row["INVOICE CATEGORY"] || row.CATEGORY || fallbackProductName;
    const fallbackDesc =
      row[partyField] ||
      row.DESCRIPTION ||
      row.NARRATION ||
      invoiceNo ||
      "";

    const rowBeforeTax = ftaNumber(row["BEFORE TAX (AED)"]);
    const rowVat = ftaNumber(row["VAT (AED)"]);
    const rowZero = ftaNumber(row["ZERO RATED (AED)"]);
    const isStandardRated = rowVat > 0;
    const taxCode = isStandardRated ? "SR" : (rowZero > 0 || rowBeforeTax > 0 ? "ZR" : "ZR");

    const lineItems = Array.isArray(row.LINE_ITEMS) && row.LINE_ITEMS.length
      ? row.LINE_ITEMS
      : null;

    if (lineItems && lineItems.length) {
      const sumLine = lineItems.reduce(
        (s, li) => s + ftaNumber(li?.net_amount),
        0
      );
      lineItems.forEach((item) => {
        const supply = ftaNumber(item?.net_amount);
        const allocFactor = sumLine > 0 ? supply / sumLine : 1 / lineItems.length;
        const vat = isStandardRated
          ? Math.round(rowVat * allocFactor * 100) / 100
          : 0;
        const counterKey = String(invoiceNo || "");
        const next = (lineCounts.get(counterKey) || 0) + 1;
        lineCounts.set(counterKey, next);
        out.push({
          [countryKey]: country,
          [trnKey]: trn,
          InvoiceDate: ftaFormatDmy(date),
          "Invoice No.": invoiceNo,
          TransactionID: invoiceNo,
          "Line No.": next,
          ProductDesc: item?.description || fallbackDesc,
          ProductName: productName,
          [supplyKey]: supply,
          VATValueAED: vat,
          TaxCode: supply > 0 ? (vat > 0 ? "SR" : "ZR") : taxCode,
          Country: "",
          VATFCY: 0,
          [fcyKey]: 0,
          FCYCode: "",
        });
      });
    } else {
      const counterKey = String(invoiceNo || "");
      const next = (lineCounts.get(counterKey) || 0) + 1;
      lineCounts.set(counterKey, next);
      out.push({
        [countryKey]: country,
        [trnKey]: trn,
        InvoiceDate: ftaFormatDmy(date),
        "Invoice No.": invoiceNo,
        TransactionID: invoiceNo,
        "Line No.": next,
        ProductDesc: fallbackDesc,
        ProductName: productName,
        [supplyKey]: rowBeforeTax,
        VATValueAED: rowVat,
        TaxCode: taxCode,
        Country: "",
        VATFCY: 0,
        [fcyKey]: 0,
        FCYCode: "",
      });
    }
  }

  return out;
}

function ftaAggregateLedger(salesLines, purchaseLines) {
  const ledger = [];

  const salesByInvoice = new Map();
  for (const r of salesLines) {
    const key = String(r["Invoice No."] || "");
    const cur = salesByInvoice.get(key) || {
      AccountName: r.ProductName || "Product Sales",
      TransactionSource: key,
      SourceCode: "Invoice",
      Debit: 0,
      Credit: 0,
    };
    cur.Credit += ftaNumber(r.SupplyValueAED);
    salesByInvoice.set(key, cur);
  }
  for (const entry of salesByInvoice.values()) {
    ledger.push({
      "AccountNo.": "",
      AccountName: entry.AccountName,
      TransactionSource: entry.TransactionSource,
      SourceCode: entry.SourceCode,
      Debit: 0,
      Credit: entry.Credit,
      Balance: entry.Credit,
    });
  }

  const purchaseByInvoice = new Map();
  for (const r of purchaseLines) {
    const key = String(r["Invoice No."] || "");
    const cur = purchaseByInvoice.get(key) || {
      AccountName: r.ProductName || "Uncategorized Expense",
      TransactionSource: key,
      SourceCode: "Bill",
      Debit: 0,
      Credit: 0,
    };
    cur.Debit += ftaNumber(r.PurchaseValueAED);
    purchaseByInvoice.set(key, cur);
  }
  for (const entry of purchaseByInvoice.values()) {
    ledger.push({
      "AccountNo.": "",
      AccountName: entry.AccountName,
      TransactionSource: entry.TransactionSource,
      SourceCode: entry.SourceCode,
      Debit: entry.Debit,
      Credit: 0,
      Balance: -entry.Debit,
    });
  }

  return ledger;
}

// POST /api/vat-filing/companies/:companyId/fta-audit-filing
export async function downloadFtaAuditFiling(req, res) {
  try {
    const { companyId } = req.params;
    const {
      periodId,
      invoiceData,
      companyName,
      companyTRN,
    } = req.body || {};

    let periodRow = null;
    if (periodId) {
      const [periodRows] = await pool.query(
        `SELECT period_from, period_to, due_date FROM vat_filing_periods WHERE id = ? LIMIT 1`,
        [periodId]
      );
      periodRow = periodRows?.[0] || null;
    }

    let displayName = companyName || "";
    let displayTrn = companyTRN || "";
    try {
      const [custRows] = await pool.query(
        `SELECT customer_name, vat_trn FROM customers WHERE id = ? LIMIT 1`,
        [companyId]
      );
      if (custRows?.[0]) {
        displayName = displayName || custRows[0].customer_name || "";
        displayTrn = displayTrn || custRows[0].vat_trn || "";
      }
    } catch (lookupErr) {
      console.warn("FTA Audit: customer lookup failed", lookupErr?.message);
    }

    const { uaeSalesRows, uaePurchaseRows } = strictSplitInvoice(invoiceData || {});
    const salesLines = ftaBuildLineRows(uaeSalesRows, "sales");
    const purchaseLines = ftaBuildLineRows(uaePurchaseRows, "purchase");
    const ledgerRows = ftaAggregateLedger(salesLines, purchaseLines);

    const supplyTotal = salesLines.reduce(
      (s, r) => s + ftaNumber(r.SupplyValueAED),
      0
    );
    const salesVatTotal = salesLines.reduce(
      (s, r) => s + ftaNumber(r.VATValueAED),
      0
    );
    const purchaseTotal = purchaseLines.reduce(
      (s, r) => s + ftaNumber(r.PurchaseValueAED),
      0
    );
    const purchaseVatTotal = purchaseLines.reduce(
      (s, r) => s + ftaNumber(r.VATValueAED),
      0
    );
    const totalCredit = ledgerRows.reduce(
      (s, r) => s + ftaNumber(r.Credit),
      0
    );

    const ws = {};
    let cursor = 1;

    const salesCols = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
    const ledgerCols = ["B", "C", "D", "E", "F", "G", "H"];

    // Section 1 — Tax person header
    cursor = 2;
    ftaWriteRow(
      ws,
      cursor,
      ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
      [
        "TaxablePersonName",
        "TRN",
        "TaxAgencyName",
        "TAN",
        "TaxAgentName",
        "TAAN",
        "PeriodStart",
        "PeriodEnd",
        "FAFCreationDate",
        "ProductVersion",
      ],
      FTA_HEADER_STYLE
    );
    cursor = 3;
    ftaWriteRow(
      ws,
      cursor,
      ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"],
      [
        displayName,
        displayTrn,
        "Federal Tax Authority",
        "",
        "",
        "",
        ftaFormatHeaderDate(periodRow?.period_from),
        ftaFormatHeaderDate(periodRow?.period_to),
        ftaFormatHeaderDate(new Date()),
        "1.0",
      ]
    );

    // Section 2 — Sales
    cursor = 6;
    const salesHeaders = [
      "CustomerCountry",
      "CustomerTIN/TRN",
      "InvoiceDate",
      "Invoice No.",
      "TransactionID",
      "Line No.",
      "ProductDesc",
      "ProductName",
      "SupplyValueAED",
      "VATValueAED",
      "TaxCode",
      "Country",
      "VATFCY",
      "SupplyFCY",
      "FCYCode",
    ];
    ftaWriteRow(ws, cursor, salesCols, salesHeaders, FTA_HEADER_STYLE);
    cursor += 1;
    for (const r of salesLines) {
      ftaWriteRow(
        ws,
        cursor,
        salesCols,
        salesHeaders.map((h) => r[h] ?? "")
      );
      // Highlight numeric cells
      ["J", "K", "N", "O"].forEach((col) => {
        const cell = ws[`${col}${cursor}`];
        if (cell && cell.t === "n") cell.s = FTA_NUMBER_STYLE;
      });
      cursor += 1;
    }
    const salesEnd = cursor - 1;

    cursor = salesEnd + 2;
    ftaWriteRow(
      ws,
      cursor,
      ["B", "C"],
      ["SupplyValueTotal", "VATValueAED"],
      FTA_TOTAL_LABEL_STYLE
    );
    cursor += 1;
    ftaWriteRow(ws, cursor, ["B", "C"], [supplyTotal, salesVatTotal]);
    ws[`B${cursor}`].s = FTA_TOTAL_VALUE_STYLE;
    ws[`C${cursor}`].s = FTA_TOTAL_VALUE_STYLE;

    // Section 3 — Purchase
    cursor += 4;
    const purchaseHeaders = [
      "SupplierCountry",
      "SupplierTRN/TIN",
      "InvoiceDate",
      "Invoice No.",
      "TransactionID",
      "Line No.",
      "ProductDesc",
      "ProductName",
      "PurchaseValueAED",
      "VATValueAED",
      "TaxCode",
      "Country",
      "VATFCY",
      "PurchaseFCY",
      "FCYCode",
    ];
    ftaWriteRow(ws, cursor, salesCols, purchaseHeaders, FTA_HEADER_STYLE);
    cursor += 1;
    for (const r of purchaseLines) {
      ftaWriteRow(
        ws,
        cursor,
        salesCols,
        purchaseHeaders.map((h) => r[h] ?? "")
      );
      ["J", "K", "N", "O"].forEach((col) => {
        const cell = ws[`${col}${cursor}`];
        if (cell && cell.t === "n") cell.s = FTA_NUMBER_STYLE;
      });
      cursor += 1;
    }
    const purchaseEnd = cursor - 1;

    cursor = purchaseEnd + 2;
    ftaWriteRow(
      ws,
      cursor,
      ["B", "C"],
      ["PurchaseValueTotal", "VATValueAED"],
      FTA_TOTAL_LABEL_STYLE
    );
    cursor += 1;
    ftaWriteRow(ws, cursor, ["B", "C"], [purchaseTotal, purchaseVatTotal]);
    ws[`B${cursor}`].s = FTA_TOTAL_VALUE_STYLE;
    ws[`C${cursor}`].s = FTA_TOTAL_VALUE_STYLE;

    // Section 4 — General Ledger / Transactions
    cursor += 4;
    const ledgerHeaders = [
      "AccountNo.",
      "AccountName",
      "TransactionSource",
      "SourceCode",
      "Debit",
      "Credit",
      "Balance",
    ];
    ftaWriteRow(ws, cursor, ledgerCols, ledgerHeaders, FTA_HEADER_STYLE);
    cursor += 1;
    for (const r of ledgerRows) {
      ftaWriteRow(
        ws,
        cursor,
        ledgerCols,
        ledgerHeaders.map((h) => r[h] ?? "")
      );
      ["F", "G", "H"].forEach((col) => {
        const cell = ws[`${col}${cursor}`];
        if (cell && cell.t === "n") cell.s = FTA_NUMBER_STYLE;
      });
      cursor += 1;
    }
    const ledgerEnd = cursor - 1;

    cursor = ledgerEnd + 3;
    ftaWriteRow(
      ws,
      cursor,
      ["B", "C"],
      ["TotalCredit", "TotalCurrency"],
      FTA_TOTAL_LABEL_STYLE
    );
    cursor += 1;
    ftaWriteRow(ws, cursor, ["B", "C"], [totalCredit, "AED"]);
    ws[`B${cursor}`].s = FTA_TOTAL_VALUE_STYLE;

    // Define worksheet range
    ws["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: cursor + 1, c: 16 },
    });

    // Column widths
    ws["!cols"] = [
      { wch: 4 },  // A spacer
      { wch: 18 }, // B
      { wch: 22 }, // C
      { wch: 14 }, // D InvoiceDate
      { wch: 18 }, // E Invoice No.
      { wch: 18 }, // F TransactionID
      { wch: 9 },  // G Line No.
      { wch: 34 }, // H ProductDesc
      { wch: 22 }, // I ProductName
      { wch: 16 }, // J SupplyValue
      { wch: 14 }, // K VATValue
      { wch: 10 }, // L TaxCode
      { wch: 12 }, // M Country
      { wch: 10 }, // N VATFCY
      { wch: 14 }, // O SupplyFCY
      { wch: 10 }, // P FCYCode
    ];

    // Row heights — leave first row a touch shorter
    ws["!rows"] = [{ hpt: 12 }];

    const wb = XLSX.utils.book_new();
    const sheetName = ftaSanitizeSheetName(displayName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    const safeFileName = String(displayName || "Company").replace(/[\\\/?*\[\]:]/g, "").trim() || "Company";
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="XYA - VAT- FTA File - ${safeFileName}.xlsx"`
    );
    res.send(buf);
  } catch (err) {
    console.error("downloadFtaAuditFiling error:", err);
    res.status(500).json({ message: "Failed to generate FTA Audit Filing" });
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
      title: "VAT Filing Preview",
      downloadFileName: `Company_${companyId}_VAT_Filing_Preview.xlsx`,
      bankData: {
        columns: [
          { key: "DATE", label: "Date" },
          { key: "DESCRIPTION", label: "Description" },
          { key: "DEBIT", label: "Debit" },
          { key: "CREDIT", label: "Credit" },
          { key: "BALANCE", label: "Balance" },
        ],
        rows: [],
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

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// POST /api/vat-filing/periods/:periodId/drafts
export async function saveDraftForPeriod(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin =
      req.user.type === "admin" ||
      req.user.type === "super_admin" ||
      req.user.role === "super_admin";
    const { periodId } = req.params;
    const {
      companyId,
      companyName,
      companyTRN,
      bankData,
      invoiceData,
      status = "draft",
      bankReconData,
      salesTotal,
      purchaseTotal,
      vatSummary,
      vatReturnOverrides,
    } = req.body;

    if (!companyId || !invoiceData) {
      return res.status(400).json({
        message: "companyId and invoiceData are required",
      });
    }

    const safeBankData =
      bankData && typeof bankData === "object"
        ? bankData
        : { columns: [], rows: [], summary: {} };

    // get customer_id from vat_filing_periods
    const [periodRows] = await pool.query(
      `SELECT customer_id, user_id FROM vat_filing_periods WHERE id = ?`,
      [periodId],
    );
    if (!periodRows.length) {
      return res.status(404).json({ message: "Filing period not found" });
    }
    const customerId = periodRows[0].customer_id;
    const effectiveUserId = isAdmin ? (periodRows[0].user_id ?? null) : userId;

    const now = new Date();
    const payload = {
      companyId,
      companyName,
      companyTRN,
      periodId: Number(periodId),
      customerId,

      bankData: safeBankData,
      invoiceData,

      // Persist derived tables
      bankReconData: bankReconData ?? null,
      salesTotal: Array.isArray(salesTotal) ? salesTotal : null,
      purchaseTotal: Array.isArray(purchaseTotal) ? purchaseTotal : null,
      vatSummary: Array.isArray(vatSummary) ? vatSummary : null,
      vatReturnOverrides: vatReturnOverrides ?? null,

      savedAt: now.toISOString(),
    };
    // ❌ NO MORE "find existing draft"
    // ✅ ALWAYS CREATE A NEW JSON FILE + NEW ROW

    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const dateFolder = `${dd}-${mm}-${yyyy}`;

    const jsonDir = path.join(UPLOADS_ROOT, "vat_filing", "json", dateFolder);
    ensureDirSync(jsonDir);

    const ts = now.getTime();
    const safeName = `vat_company-${companyId}_period-${periodId}_${ts}.json`;
    const fullJsonPath = path.join(jsonDir, safeName);

    fs.writeFileSync(fullJsonPath, JSON.stringify(payload, null, 2), "utf8");
    const relativeJsonPath = path.relative(UPLOADS_ROOT, fullJsonPath);

    const [ins] = await pool.query(
      `
        INSERT INTO vat_filing_runs
          (user_id, customer_id, vat_period_id, status,
           company_name, company_trn, combined_json_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        effectiveUserId,
        customerId,
        periodId,
        status,
        companyName || "",
        companyTRN || "",
        relativeJsonPath,
      ],
    );
    const runId = ins.insertId;

    const [runRows] = await pool.query(
      `SELECT * FROM vat_filing_runs WHERE id = ?`,
      [runId],
    );

    res.status(201).json({ run: runRows[0], payload });
  } catch (err) {
    console.error("saveDraftForPeriod error:", err);
    res.status(500).json({ message: "Failed to save VAT filing draft" });
  }
}

// GET /api/vat-filing/periods/:periodId/runs
export async function listRunsForPeriod(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin =
      req.user.type === "admin" ||
      req.user.type === "super_admin" ||
      req.user.role === "super_admin";
    const { periodId } = req.params;
    let sql;
    let params;
    if (isAdmin) {
      sql = `SELECT id, status, company_name, company_trn,
                    combined_json_path, created_at, updated_at
             FROM vat_filing_runs
             WHERE vat_period_id = ?
             ORDER BY created_at DESC`;
      params = [periodId];
    } else {
      sql = `SELECT id, status, company_name, company_trn,
                    combined_json_path, created_at, updated_at
             FROM vat_filing_runs
             WHERE vat_period_id = ? AND user_id = ?
             ORDER BY created_at DESC`;
      params = [periodId, userId];
    }
    const [rows] = await pool.query(sql, params);
    res.json({ runs: rows });
  } catch (err) {
    console.error("listRunsForPeriod error:", err);
    res.status(500).json({ message: "Failed to load VAT filing drafts" });
  }
}

// GET /api/vat-filing/runs/:runId
export async function getRunById(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin =
      req.user.type === "admin" ||
      req.user.type === "super_admin" ||
      req.user.role === "super_admin";
    const { runId } = req.params;
    const [rows] = await pool.query(
      isAdmin
        ? `SELECT * FROM vat_filing_runs WHERE id = ? LIMIT 1`
        : `SELECT * FROM vat_filing_runs WHERE id = ? AND user_id = ? LIMIT 1`,
      isAdmin ? [runId] : [runId, userId],
    );
    if (!rows.length) {
      return res.status(404).json({ message: "VAT filing run not found" });
    }
    const run = rows[0];

    const fullJsonPath = path.join(UPLOADS_ROOT, run.combined_json_path);
    if (!fs.existsSync(fullJsonPath)) {
      return res
        .status(410)
        .json({ message: "Stored VAT filing JSON missing" });
    }
    const raw = fs.readFileSync(fullJsonPath, "utf8");
    const payload = JSON.parse(raw);

    res.json({ run, payload });
  } catch (err) {
    console.error("getRunById error:", err);
    res.status(500).json({ message: "Failed to load VAT filing run" });
  }
}

// PUT /api/vat-filing/runs/:runId
export async function updateRunById(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin =
      req.user.type === "admin" ||
      req.user.type === "super_admin" ||
      req.user.role === "super_admin";
    const { runId } = req.params;
    const {
      status,
      companyId, // optional
      companyName,
      companyTRN,
      bankData,
      invoiceData,
      bankReconData,
      salesTotal,
      purchaseTotal,
      vatSummary,
      vatReturnOverrides,
    } = req.body;

    // 1) Load the run row (only for this user)
    const [rows] = await pool.query(
      isAdmin
        ? `SELECT * FROM vat_filing_runs WHERE id = ? LIMIT 1`
        : `SELECT * FROM vat_filing_runs WHERE id = ? AND user_id = ? LIMIT 1`,
      isAdmin ? [runId] : [runId, userId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "VAT filing run not found" });
    }

    const run = rows[0];

    // 2) Load existing JSON payload from disk
    const fullJsonPath = path.join(UPLOADS_ROOT, run.combined_json_path);

    if (!fs.existsSync(fullJsonPath)) {
      return res
        .status(410)
        .json({ message: "Stored VAT filing JSON missing on disk" });
    }

    let oldPayload;
    try {
      const raw = fs.readFileSync(fullJsonPath, "utf8");
      oldPayload = JSON.parse(raw);
    } catch (e) {
      console.error("Failed to read existing VAT JSON:", e);
      return res
        .status(500)
        .json({ message: "Failed to read stored JSON for this run" });
    }

    const nowIso = new Date().toISOString();

    // 3) Build updated payload – merge old + new
    const updatedPayload = {
      ...oldPayload,
      companyId: companyId ?? oldPayload.companyId ?? run.customer_id,
      companyName: companyName ?? oldPayload.companyName ?? run.company_name,
      companyTRN: companyTRN ?? oldPayload.companyTRN ?? run.company_trn,

      bankData: bankData ?? oldPayload.bankData,
      invoiceData: invoiceData ?? oldPayload.invoiceData,

      // merge derived tables (keep old if frontend didn’t send anything)
      bankReconData: bankReconData ?? oldPayload.bankReconData ?? null,
      salesTotal: Array.isArray(salesTotal)
        ? salesTotal
        : (oldPayload.salesTotal ?? null),
      purchaseTotal: Array.isArray(purchaseTotal)
        ? purchaseTotal
        : (oldPayload.purchaseTotal ?? null),
      vatSummary: Array.isArray(vatSummary)
        ? vatSummary
        : (oldPayload.vatSummary ?? null),
      vatReturnOverrides:
        vatReturnOverrides ?? oldPayload.vatReturnOverrides ?? null,

      savedAt: nowIso,
    };

    // 4) Overwrite JSON file
    fs.writeFileSync(
      fullJsonPath,
      JSON.stringify(updatedPayload, null, 2),
      "utf8",
    );

    // 5) Update DB row (status / name / TRN)
    const newStatus = status || run.status || "draft";
    const newCompanyName =
      companyName ?? run.company_name ?? updatedPayload.companyName ?? "";
    const newCompanyTRN =
      companyTRN ?? run.company_trn ?? updatedPayload.companyTRN ?? "";

    await pool.query(
      isAdmin
        ? `UPDATE vat_filing_runs
           SET status = ?, company_name = ?, company_trn = ?, updated_at = NOW()
           WHERE id = ?`
        : `UPDATE vat_filing_runs
           SET status = ?, company_name = ?, company_trn = ?, updated_at = NOW()
           WHERE id = ? AND user_id = ?`,
      isAdmin
        ? [newStatus, newCompanyName, newCompanyTRN, runId]
        : [newStatus, newCompanyName, newCompanyTRN, runId, userId],
    );

    const [fresh] = await pool.query(
      `SELECT * FROM vat_filing_runs WHERE id = ?`,
      [runId],
    );

    return res.json({
      run: fresh[0],
      payload: updatedPayload,
    });
  } catch (err) {
    console.error("updateRunById error:", err);
    res.status(500).json({ message: "Failed to update VAT filing run" });
  }
}

export async function deleteRunById(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin =
      req.user.type === "admin" ||
      req.user.type === "super_admin" ||
      req.user.role === "super_admin";
    const { runId } = req.params;

    // 1) Load run row for this user
    const [rows] = await pool.query(
      isAdmin
        ? `SELECT id, combined_json_path
           FROM vat_filing_runs
           WHERE id = ?
           LIMIT 1`
        : `SELECT id, combined_json_path
           FROM vat_filing_runs
           WHERE id = ? AND user_id = ?
           LIMIT 1`,
      isAdmin ? [runId] : [runId, userId],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "VAT filing run not found" });
    }

    const run = rows[0];

    // 2) Try to delete JSON file
    if (run.combined_json_path) {
      const fullJsonPath = path.join(UPLOADS_ROOT, run.combined_json_path);
      try {
        if (fs.existsSync(fullJsonPath)) {
          fs.unlinkSync(fullJsonPath);
        }
      } catch (e) {
        // Don't hard-fail just because file delete failed – log and continue
        console.warn("Failed to delete VAT JSON file:", e?.message || e);
      }
    }

    // 3) Delete DB row
    await pool.query(
      isAdmin
        ? `DELETE FROM vat_filing_runs WHERE id = ?`
        : `DELETE FROM vat_filing_runs WHERE id = ? AND user_id = ?`,
      isAdmin ? [runId] : [runId, userId],
    );

    return res.json({ message: "VAT filing run deleted successfully" });
  } catch (err) {
    console.error("deleteRunById error:", err);
    res.status(500).json({ message: "Failed to delete VAT filing run" });
  }
}
