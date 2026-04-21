// server/lib/localStorage.js
import fs from "fs/promises";
import path from "path";

const ROOT = process.env.UPLOADS_ROOT || "uploads";

export const safeName = (s) =>
  String(s || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 255);

function dateParts(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return { dd, mm, yyyy };
}

/**
 * Build a relative path for invoices module.
 * type: "uploads" | "json"
 * NEW structure (flat date folder):
 *   invoice/{type}/DD-MM-YYYY/<filename>
 */

export function buildInvoiceLocalPath({ type, originalName }) {
  const { dd, mm, yyyy } = dateParts();
  const dateFolder = `${dd}-${mm}-${yyyy}`; // shows as DD/MM/YYYY conceptually, but valid on disk
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("invoice", type, dateFolder, fname);
}

export function buildBankLocalPath({ type, originalName }) {
  const { dd, mm, yyyy } = dateParts();
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("bank_statements", type, dateFolder, fname);
}

export function buildEmiratesLocalPath({ type, originalName }) {
  const { dd, mm, yyyy } = dateParts();
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("emirates_id", type, dateFolder, fname);
}

export function buildPassportLocalPath({ type, originalName }) {
  const { dd, mm, yyyy } = dateParts();
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("passports", type, dateFolder, fname);
}

export function buildVisaLocalPath({ type, originalName }) {
  const dd = String(new Date().getDate()).padStart(2, "0");
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");
  const yyyy = String(new Date().getFullYear());
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("visa", type, dateFolder, fname);
}

export function buildTradeLicenseLocalPath({ type, originalName }) {
  const dd = String(new Date().getDate()).padStart(2, "0");
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");
  const yyyy = String(new Date().getFullYear());
  const dateFolder = `${dd}-${mm}-${yyyy}`;
  const fname = `${Date.now()}-${safeName(originalName)}`;
  return path.join("trade_license", type, dateFolder, fname);
}

async function ensureDir(dirAbs) {
  await fs.mkdir(dirAbs, { recursive: true });
}

export async function copyToLocal({ srcAbsPath, destRelPath }) {
  const absRoot = path.resolve(ROOT);
  const absDest = path.join(absRoot, destRelPath);
  await ensureDir(path.dirname(absDest));
  await fs.copyFile(srcAbsPath, absDest);
  return { abs: absDest, rel: destRelPath };
}

export async function writeJsonLocal({ json, destRelPath }) {
  const absRoot = path.resolve(ROOT);
  const absDest = path.join(absRoot, destRelPath);
  await ensureDir(path.dirname(absDest));
  await fs.writeFile(absDest, JSON.stringify(json, null, 2), "utf-8");
  return { abs: absDest, rel: destRelPath };
}

export async function readJsonLocal(destRelPath) {
  const absRoot = path.resolve(ROOT);
  const absDest = path.join(absRoot, destRelPath);
  const data = await fs.readFile(absDest, "utf-8");
  return JSON.parse(data);
}

export async function writeBufferLocal({ buffer, destRelPath }) {
  const absRoot = path.resolve(ROOT);
  const absDest = path.join(absRoot, destRelPath);
  await ensureDir(path.dirname(absDest));
  await fs.writeFile(absDest, buffer);
  return { abs: absDest, rel: destRelPath };
}

export function withExt(p, ext = ".json") {
  if (p.toLowerCase().endsWith(ext)) return p;
  return p + ext;
}
