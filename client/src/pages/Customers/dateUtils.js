const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export const DATE_FIELD_NAMES = new Set([
  "dateOfIncorporation",
  "licenseIssueDate",
  "licenseExpiryDate",
  "vatRegisteredDate",
  "vatReturnDueDate",
  "ctRegisteredDate",
  "firstCtPeriodStartDate",
  "firstCtPeriodEndDate",
  "firstCtReturnDueDate",
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isValidDateParts(day, month, year) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return false;
  }
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatParts(day, month, year) {
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

function parseNamedMonthDate(value) {
  const match = String(value)
    .trim()
    .match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !isValidDateParts(day, month, year)) return null;
  return { day, month, year };
}

function parseNumericDate(value) {
  const cleaned = String(value).trim().replace(/\./g, "/");

  let match = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (isValidDateParts(day, month, year)) return { day, month, year };
  }

  match = cleaned.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (isValidDateParts(day, month, year)) return { day, month, year };
  }

  match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = Number(match[3]);

    if (second > 12 && isValidDateParts(second, first, year)) {
      return { day: second, month: first, year };
    }
    if (first > 12 && isValidDateParts(first, second, year)) {
      return { day: first, month: second, year };
    }
    if (isValidDateParts(second, first, year)) {
      return { day: second, month: first, year };
    }
    if (isValidDateParts(first, second, year)) {
      return { day: first, month: second, year };
    }
  }

  return null;
}

export function normalizeDateDisplay(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  const named = parseNamedMonthDate(raw);
  if (named) return formatParts(named.day, named.month, named.year);

  const numeric = parseNumericDate(raw);
  if (numeric) return formatParts(numeric.day, numeric.month, numeric.year);

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatParts(parsed.getDate(), parsed.getMonth() + 1, parsed.getFullYear());
  }

  return raw;
}

export function dateDisplayToIso(value) {
  if (!value) return "";
  const normalized = normalizeDateDisplay(value);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidDateParts(day, month, year)) return "";
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
