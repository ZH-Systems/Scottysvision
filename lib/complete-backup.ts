import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { readLocal, writeLocal, today } from "./local";
export async function exportComplete(
  state: any,
  request: (url: string) => Promise<any>,
) {
  const refs = new Set([
      ...state.events
        .filter((e: any) => e.kind === "invoice")
        .flatMap((e: any) => e.data.attachments.map((f: any) => f.id)),
      ...(state.invoiceDraft?.attachments || []).map((f: any) => f.id),
    ]),
    files = (await readLocal("files")).filter((f: any) => refs.has(f.id));
  const metadataById = new Map(
    [
      ...state.events
        .filter((e: any) => e.kind === "invoice")
        .flatMap((e: any) => e.data.attachments),
      ...(state.invoiceDraft?.attachments || []),
    ].map((f: any) => [f.id, f]),
  );
  for (const id of refs) {
    if (files.some((f: any) => f.id === id)) continue;
    try {
      const signed = await request(
        "/api/files?id=" + encodeURIComponent(String(id)),
      );
      const response = await fetch(signed.url);
      if (!response.ok) throw Error("Download failed.");
      const blob = await response.blob();
      const file = { ...metadataById.get(id), id, blob };
      files.push(file);
    } catch {
      throw Error(
        "A receipt original is unavailable. Sign in and reconnect, or use the records-only JSON export and retain the missing receipt separately.",
      );
    }
  }
  const entries: Record<string, Uint8Array> = {},
    metadata = [];
  let size = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer());
    size += data.length;
    if (size > 200 * 1024 * 1024)
      throw Error(
        "This export exceeds 200 MB. Export records and keep receipt originals separately.",
      );
    entries["attachments/" + f.id] = data;
    const { blob, ...meta } = f;
    metadata.push(meta);
  }
  entries["vision.json"] = strToU8(
    JSON.stringify({
      visionSchema: 1,
      exportedAt: Date.now(),
      state,
      attachmentManifest: metadata,
    }),
  );
  const zip = zipSync(entries, { level: 0 });
  const url = URL.createObjectURL(
      new Blob([zip as BlobPart], { type: "application/zip" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "Scottys_Complete_Backup_" + today() + ".zip";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function importComplete(
  file: File,
  importRecords: (f: File, rebind: boolean) => Promise<void>,
  rebind: boolean,
) {
  if (file.size > 210 * 1024 * 1024)
    throw Error("Choose a backup archive under 210 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Inspect central-directory declared sizes before decompression to bound expansion.
  const view = new DataView(bytes.buffer);
  let total = 0,
    entriesCount = 0;
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      total += view.getUint32(i + 24, true);
      entriesCount++;
      if (total > 220 * 1024 * 1024 || entriesCount > 5000)
        throw Error("Backup archive expands beyond the allowed size.");
      i +=
        45 +
        view.getUint16(i + 28, true) +
        view.getUint16(i + 30, true) +
        view.getUint16(i + 32, true);
    }
  }
  let expanded = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      expanded += entry.originalSize;
      if (expanded > 220 * 1024 * 1024)
        throw Error("Backup expands beyond the allowed size.");
      return true;
    },
  });
  if (!entries["vision.json"])
    throw Error("This is not a complete Vision backup.");
  const text = strFromU8(entries["vision.json"]),
    v = JSON.parse(text);
  for (const f of v.attachmentManifest || []) {
    if (
      !/^[-A-Za-z0-9_.:]{1,220}$/.test(f.id) ||
      !entries["attachments/" + f.id]
    )
      throw Error("Backup is missing attachment bytes.");
  }
  await importRecords(
    new File([text], "vision.json", { type: "application/json" }),
    rebind,
  );
  for (const f of v.attachmentManifest || []) {
    const data = entries["attachments/" + f.id];
    await writeLocal("files", {
      ...f,
      blob: new Blob([data as BlobPart], { type: f.type }),
      synced: false,
      syncedScopes: [],
    });
  }
}
