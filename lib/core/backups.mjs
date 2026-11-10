export function wasteBackup(state, catalog) {
  const settings = state.events
    .filter((e) => e.kind === "settings" && e.entityId === "waste-lists")
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0]?.data;
  return {
    schema: 1,
    items: catalog.map((x) => ({
      ...x,
      active: x.active !== false,
      confirmed: x.confirmed === true,
      cost: x.cost ?? null,
    })),
    employees: settings?.employees || [],
    reasons: settings?.reasons || ['Spoilage','Overproduction','Expired','Dropped / damaged','Quality reject','Staff meal','Customer return'].map((name,i)=>({id:'reason-'+i,name,active:true})),
    records: state.events.filter((e) => e.kind === "waste").map((e) => e.data),
    voids: state.events
      .filter((e) => e.kind === "waste_void")
      .map((e) => e.data),
    settings: state.wasteSettings || { location: "", lastEmployee: "" },
  };
}
export function wingsBackup(state) {
  return {
    schema: 1,
    batches: state.events
      .filter((e) => e.kind === "wing_batch")
      .map((e) => ({
        ...e.data,
        events: state.events
          .filter((x) => x.kind === "wing_event" && x.entityId === e.entityId)
          .map((x) => x.data)
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)),
        round: state.wingRounds?.[e.entityId] || null,
      })),
    settings: { staff: state.wingStaff || "", sound: !!state.wingSound },
  };
}
export const catalogTemplate =
  "id,name,base_unit,cost_per_unit,cost_basis,cost_date,active,grams_per_each,ml_per_each,vision_id\r\n";
