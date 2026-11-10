import {
  admin,
  identity,
  body,
  json,
  fail,
  hash,
  canonical,
  checked,
  AppError,
} from "@/lib/server";
import { validateEvent } from "@/lib/validation";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const user = await identity(req, true, "viewer"),
      input = await body(req);
    if (!Array.isArray(input.events) || input.events.length > 40)
      throw new AppError(400, "Sync up to 40 entries at once.");
    const catalog = input.catalog || [];
    if (!Array.isArray(catalog) || catalog.length > 5000)
      throw new AppError(400, "Invalid catalog.");
    for (const item of catalog)
      validateEvent({
        id: item.id,
        entityId: item.id,
        kind: "ingredient",
        at: Date.now(),
        data: item,
      });
    const drafts = input.drafts || [];
    if (!Array.isArray(drafts) || drafts.length > 40)
      throw new AppError(400, "Sync up to 40 drafts.");
    for (const d of drafts) {
      if (
        typeof d.key !== "string" ||
        d.key.length > 250 ||
        !d.payload ||
        !["recipe", "invoice", "preferences"].includes(d.payload.kind) ||
        canonical(d.payload).length > 180000 ||
        !Number.isSafeInteger(d.at) ||
        d.at < 1 ||
        d.at > Date.now() + 60000
      )
        throw new AppError(400, "Invalid draft revision.");
      cleanDraftId(d.revision);
      if (d.parentRevision) cleanDraftId(d.parentRevision);
    }
    const events = await Promise.all(
      input.events.map(async (x: any) => {
        const e = validateEvent(x);
        return {
          ...e,
          hash: await hash(
            canonical({
              kind: e.kind,
              entityId: e.entityId,
              at: e.at,
              data: e.data,
            }),
          ),
        };
      }),
    );
    return json(
      await checked(
        admin().rpc("vision_sync_workspace", {
          p_workspace: user.scope,
          p_actor: user.id,
          p_drafts: drafts,
          p_events: events,
          p_since:
            Number.isSafeInteger(input.since) && input.since >= 0
              ? input.since
              : 0,
          p_catalog: catalog,
          p_catalog_at:
            Number.isSafeInteger(input.catalogAt) && input.catalogAt >= 0
              ? input.catalogAt
              : 0,
        }),
      ),
    );
  } catch (e) {
    return fail(e);
  }
}

function cleanDraftId(x: unknown) {
  if (typeof x !== "string" || !/^[-A-Za-z0-9_.:]{1,220}$/.test(x))
    throw new AppError(400, "Invalid draft ID.");
}
