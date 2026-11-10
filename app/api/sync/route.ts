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
    const user = await identity(req, true),
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
        admin().rpc("vision_sync", {
          p_owner: user.id,
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
