import {
  admin,
  identity,
  body,
  json,
  fail,
  cleanId,
  hash,
  checked,
  bucketName,
  AppError,
} from "@/lib/server";
function allowed(b: Uint8Array, t: string) {
  if (t === "application/pdf")
    return new TextDecoder().decode(b.slice(0, 5)) === "%PDF-";
  if (t === "image/jpeg") return b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (t === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v);
  if (t === "image/webp")
    return (
      new TextDecoder().decode(b.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(b.slice(8, 12)) === "WEBP"
    );
  return false;
}
export async function POST(req: Request) {
  try {
    const user = await identity(req, true),
      x = await body(req, 10000),
      id = cleanId(x.id),
      db = admin();
    if (
      !/^[a-f0-9]{64}$/.test(x.hash) ||
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(
        x.type,
      ) ||
      !Number.isInteger(x.size) ||
      x.size < 1 ||
      x.size > 16777216
    )
      throw new AppError(400, "Use JPEG, PNG, WebP or PDF under 16 MB.");
    const existing: any = await checked(
      db
        .from("vision_files")
        .select("hash")
        .eq("owner", user.id)
        .eq("file_id", id)
        .maybeSingle(),
    );
    if (existing) {
      if (existing.hash !== x.hash)
        throw new AppError(409, "File ID belongs to different bytes.");
      return json({ status: "success", id, confirmed: true });
    }
    const key = user.id + "/" + id + "/" + x.hash;
    if (x.mode === "prepare") {
      const recovered = await db.storage.from(bucketName()).download(key);
      if (recovered.data) {
        const bytes = await recovered.data.arrayBuffer();
        if (
          bytes.byteLength === x.size &&
          (await hash(bytes)) === x.hash &&
          allowed(new Uint8Array(bytes), x.type)
        ) {
          const row = {
            key,
            owner: user.id,
            file_id: id,
            name: String(x.name || "receipt").slice(0, 200),
            mime: x.type,
            size: x.size,
            hash: x.hash,
            created_at: Date.now(),
          };
          const { error } = await db
            .from("vision_files")
            .upsert(row, {
              onConflict: "owner,file_id",
              ignoreDuplicates: true,
            });
          if (error)
            throw new AppError(
              502,
              "Attachment recovery could not be confirmed.",
            );
          const stored: any = await checked(
            db
              .from("vision_files")
              .select("hash")
              .eq("owner", user.id)
              .eq("file_id", id)
              .maybeSingle(),
          );
          if (stored?.hash !== x.hash)
            throw new AppError(409, "Attachment ID conflicted.");
          return json({ status: "success", id, confirmed: true });
        }
        throw new AppError(
          409,
          "An uploaded attachment has different bytes. Export a backup before reviewing.",
        );
      }
      const data = await checked(
        db.storage.from(bucketName()).createSignedUploadUrl(key),
      );
      return json({ status: "success", id, key, token: data!.token });
    }
    if (x.mode !== "complete")
      throw new AppError(400, "Choose upload preparation or completion.");
    const blob = await checked(db.storage.from(bucketName()).download(key)),
      bytes = await blob!.arrayBuffer();
    if (
      bytes.byteLength !== x.size ||
      (await hash(bytes)) !== x.hash ||
      !allowed(new Uint8Array(bytes), x.type)
    )
      throw new AppError(
        400,
        "Uploaded file did not match its verified metadata.",
      );
    const { error } = await db
      .from("vision_files")
      .insert({
        key,
        owner: user.id,
        file_id: id,
        name: String(x.name || "receipt").slice(0, 200),
        mime: x.type,
        size: x.size,
        hash: x.hash,
        created_at: Date.now(),
      });
    if (error) {
      const row: any = await checked(
        db
          .from("vision_files")
          .select("hash")
          .eq("owner", user.id)
          .eq("file_id", id)
          .maybeSingle(),
      );
      if (row?.hash !== x.hash)
        throw new AppError(409, "File registration conflicted.");
    }
    return json({ status: "success", id, confirmed: true });
  } catch (e) {
    return fail(e);
  }
}
export async function GET(req: Request) {
  try {
    const u = await identity(req),
      id = cleanId(new URL(req.url).searchParams.get("id")),
      db = admin(),
      row: any = await checked(
        db
          .from("vision_files")
          .select("key")
          .eq("owner", u.id)
          .eq("file_id", id)
          .maybeSingle(),
      );
    if (!row) throw new AppError(404, "Attachment not found.");
    const data = await checked(
      db.storage.from(bucketName()).createSignedUrl(row.key, 60),
    );
    return json({ status: "success", url: data!.signedUrl });
  } catch (e) {
    return fail(e);
  }
}
