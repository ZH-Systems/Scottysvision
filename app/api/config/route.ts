import { config, json } from "@/lib/server";
export const dynamic = "force-dynamic";
export function GET() {
  const c = config();
  return json({
    status: "success",
    url: c.url,
    anonKey: c.anon,
    bucket: process.env.SUPABASE_STORAGE_BUCKET || "vision-attachments",
    configured: !!(c.url && c.anon && c.service),
    sheetsConfigured: !!(
      process.env.VISION_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY &&
      process.env.VISION_SHEETS_ALLOWED_EMAILS
    ),
  });
}
