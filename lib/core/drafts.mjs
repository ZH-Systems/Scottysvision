const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function trackDraftChanges(before, next) {
  const dirty = { ...next.draftDirty };
  for (const [field, kind] of [
    ["draft", "recipe"],
    ["invoiceDraft", "invoice"],
  ]) {
    if (!equal(before[field], next[field])) {
      const id = next[field]?.id || before[field]?.id;
      if (id) dirty[kind + ":" + id] = { kind, value: next[field] ?? null };
    }
  }
  const keys = ["wingRounds", "wingSound", "wingStaff", "wasteSettings"];
  if (keys.some((k) => !equal(before[k], next[k])))
    dirty["preferences:" + next.deviceId] = {
      kind: "preferences",
      value: Object.fromEntries(keys.map((k) => [k, next[k] ?? null])),
    };
  return { ...next, draftDirty: dirty };
}
export function prepareDrafts(state, makeId, now) {
  const parents = new Map(
    (state.draftHeads || []).map((h) => [h.draft_key, h.revision]),
  );
  const out = [...(state.draftOutbox || [])];
  for (const [key, payload] of Object.entries(state.draftDirty || {})) {
    const pending = out.filter((x) => x.key === key).at(-1);
    out.push({
      key,
      revision: makeId(),
      parentRevision:
        pending?.revision ||
        state.draftParents?.[key] ||
        parents.get(key) ||
        null,
      at: now,
      payload,
    });
  }
  return { ...state, draftOutbox: out, draftDirty: {}, draftParents: {} };
}
export function acknowledgeDrafts(state, sent, heads) {
  const ids = new Set(sent.map((x) => x.revision));
  return {
    ...state,
    draftOutbox: (state.draftOutbox || []).filter((x) => !ids.has(x.revision)),
    draftHeads: heads || state.draftHeads || [],
  };
}
