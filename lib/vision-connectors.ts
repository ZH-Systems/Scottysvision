import "server-only";
import { GoogleAuth } from "google-auth-library";
import { AppError } from "./server";
export const SHEET = process.env.VISION_SPREADSHEET_ID || "";
async function client() {
  if (
    !SHEET ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY
  )
    throw new AppError(
      503,
      "Google Sheets is not configured. Supabase backup and local logging remain available.",
    );
  return new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  }).getClient();
}
export async function invoke(action: string, args: any) {
  if (args.spreadsheet_id !== SHEET)
    throw new AppError(403, "Workbook is not permitted.");
  const c = await client(),
    base =
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(SHEET);
  let url = base,
    method: "GET" | "POST" = "GET",
    data: any;
  if (action === "get_spreadsheet_range") {
    url +=
      "/values/" +
      encodeURIComponent(
        "'" + args.sheet_name.replace(/'/g, "''") + "'!" + args.range,
      ) +
      "?valueRenderOption=UNFORMATTED_VALUE";
  } else if (action === "get_spreadsheet_cells") {
    const q = new URLSearchParams({
      includeGridData: "true",
      fields:
        "sheets(data(rowData(values(userEnteredValue,effectiveValue,formattedValue,dataValidation,chipRuns,userEnteredFormat))))",
    });
    for (const r of args.ranges) q.append("ranges", r);
    url += "?" + q;
  } else if (action === "batch_update_spreadsheet") {
    url += ":batchUpdate";
    method = "POST";
    data = { requests: args.requests, includeSpreadsheetInResponse: false };
  } else if (action === "get_spreadsheet_metadata")
    url += "?includeGridData=false";
  else throw new AppError(400, "Unsupported Sheets action.");
  // No automatic retry for potentially completed writes.
  try {
    const r = await c.request({ url, method, data, retry: false });
    return r.data as any;
  } catch {
    throw new AppError(
      502,
      "Google Sheets did not confirm the operation. Check workbook access and reconcile uncertain writes before retrying.",
    );
  }
}
export const metadata = () =>
  invoke("get_spreadsheet_metadata", { spreadsheet_id: SHEET });
export const range = (name: string, cells: string) =>
  invoke("get_spreadsheet_range", {
    spreadsheet_id: SHEET,
    sheet_name: name,
    range: cells,
  });
export function requireTab(meta: any, name: string, min: number) {
  const p = meta.sheets?.find(
    (s: any) => s.properties?.title === name,
  )?.properties;
  if (!p || p.gridProperties?.columnCount < min)
    throw new AppError(409, "Vision tab " + name + " is missing or changed.");
  return p;
}
export function connectionFailure(_e: unknown) {
  return null;
}
export function permitSheets(user: { email?: string }) {
  const list = (process.env.VISION_SHEETS_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.includes(user.email?.toLowerCase() || ""))
    throw new AppError(
      403,
      "This account is not enabled for the shared workbook. Configure VISION_SHEETS_ALLOWED_EMAILS.",
    );
}
