(function (root) {
  'use strict';
  const MIN = 60000, HOUR = 60 * MIN;
  const TYPES = new Set(['dry_start','dry_end','raw_check','cook_start','oven_out','cook_check','cook_batch_check','cooler_in','cool_check','packed','note','void','clock_fix','discarded']);
  function uid() { return root.crypto?.randomUUID?.() || 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function event(type, values = {}, now = Date.now()) { return {id:uid(),type,at:now,enteredAt:now,...values}; }
  function active(batch) { const voids = new Set(batch.events.filter(e=>e.type==='void').map(e=>e.ref)); return batch.events.filter(e=>e.type!=='void'&&!voids.has(e.id)); }
  function temperature(input) {
    if (typeof input !== 'string' || !/^-?\d+(?:[.,]\d{1,2})?$/.test(input.trim())) throw Error('Enter the actual wing temperature in °C.');
    const n=Number(input.trim().replace(',','.'));
    if (!Number.isFinite(n)||n < -40||n > 120) throw Error('Check the probe is set to °C. Enter a value from -40 to 120°C.');
    return n;
  }
  function fmt(n) { return n==null?'—': Number(n.toFixed(2)).toString(); }
  const dt = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  function parts(t) { return Object.fromEntries(dt.formatToParts(t).filter(p=>p.type!=='literal').map(p=>[p.type,p.value])); }
  function localInput(t) { const p=parts(t);return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
  function localTime(t) { if(t==null)return 'Unknown'; const p=parts(t);return `${p.hour}:${p.minute}`; }
  function localDateTime(t) { if(t==null)return 'Unknown';return localInput(t).replace('T',' '); }
  function parseLocal(s) {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))throw Error('Enter the actual date and time.');
    const [y,m,d,h,min]=s.match(/\d+/g).map(Number);const target=Date.UTC(y,m-1,d,h,min);let guess=target;
    for(let i=0;i<4;i++){const p=parts(guess);guess+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);}
    if(localInput(guess)!==s)throw Error('That Toronto date/time is not valid.');
    return guess;
  }
  function evaluate(batch, now = Date.now()) {
    const ev=active(batch).slice().sort((a,b)=>a.at-b.at);
    const first=t=>ev.find(e=>e.type===t), last=t=>ev.filter(e=>e.type===t).at(-1);
    const fixed=last('clock_fix');const out=fixed?fixed.valueAt:first('oven_out')?.at??null;
    const start=first('cook_start')?.at??null;
    const dry=first('dry_start')?.at??null;
    const packed=last('packed');
    const base={out,start,dry,packed:packed?.at??null,trays:[],reasons:[],allCold:false,nextDue:null,useBy:out==null?null:out+72*HOUR};
    if(last('discarded'))return {...base,status:'discarded',title:'Discard recorded'};
    if(out==null && batch.mode!=='existing') {
      if(start!=null)return {...base,status:'cooking',title:'Oven timer',nextDue:start+20*MIN};
      if(dry!=null)return {...base,status:'brining',title:'Overnight fridge rest',nextDue:dry+18*HOUR,restEnd:dry+20*HOUR};
      return {...base,status:'new',title:'Start batch'};
    }
    if(out==null)base.reasons.push('Actual oven-out time is missing.');
    if(out!=null&&out>now)base.reasons.push('Oven-out time is in the future. Check the clock.');
    if(ev.some(e=>e.type==='raw_check'&&e.c>4))base.reasons.push('Starting wings were above 4°C. Manager review is needed.');
    if(ev.some(e=>e.type==='note'&&e.flag))base.reasons.push('A manager review was requested.');
    if(ev.some(e=>e.at>now))base.reasons.push('A record is dated in the future. Check the device clock and actual time.');
    const group=ev.find(e=>e.type==='cook_batch_check'&&e.c>=74&&e.held15===true&&out!=null&&e.at<=now&&(start==null||e.at>=start));
    for(const tray of batch.trays) {
      const cook=ev.find(e=>e.type==='cook_check'&&e.tray===tray.id&&e.c>=74&&e.held15===true&&out!=null&&e.at<=now&&(start==null||e.at>=start))||group;
      const readings=ev.filter(e=>e.type==='cool_check'&&e.tray===tray.id);
      const qualifying=readings.filter(e=>out!=null&&cook&&e.at>=out&&e.at>=cook.at&&e.at<=now);
      const first20=qualifying.find(e=>e.c<=20), first4=qualifying.find(e=>e.c<=4), latest=readings.at(-1);
      const deadline1=out==null?null:out+2*HOUR;
      const deadline2=out==null?null:Math.min(out+6*HOUR, first20?first20.at+4*HOUR:Infinity);
      const errors=[];
      if(first20&&first20.at>deadline1)errors.push(`${tray.label}: the ≤20°C reading was late.`);
      else if(!first20&&deadline1!=null&&now>deadline1)errors.push(`${tray.label}: no timely ≤20°C reading.`);
      if(first4&&first4.at>deadline2)errors.push(`${tray.label}: the ≤4°C reading was late.`);
      else if(!first4&&deadline2!=null&&now>deadline2)errors.push(`${tray.label}: no timely ≤4°C reading.`);
      if(first4&&latest?.c>4&&deadline2!=null&&now>deadline2)errors.push(`${tray.label}: above 4°C after the final deadline.`);
      const cold=!!cook&&!!first20&&!!first4&&latest?.c<=4&&errors.length===0;
      base.trays.push({...tray,cook,latest,first20,first4,deadline1,deadline2,cold,errors});
      base.reasons.push(...errors);
    }
    base.allCold=base.trays.length>0&&base.trays.every(t=>t.cold);
    if(packed&&base.allCold&&base.trays.some(t=>t.first4.at>packed.at))base.reasons.push('Packing was recorded before the final cold checks. Review the actual times.');
    const cookMissing=base.trays.some(t=>!t.cook);
    if(batch.mode==='existing'&&cookMissing)base.reasons.push('Earlier cooking temperatures are unverified.');
    if(base.reasons.length)return {...base,status:'review',title:'Hold for manager review',needsCook:cookMissing};
    if(cookMissing)return {...base,status:'cookcheck',title:'Confirm the cook',needsCook:true};
    if(base.allCold)return {...base,status:packed?'packed':'cooled',title:packed?'Packed and recorded':'Cooling checks complete'};
    const cooler=last('cooler_in');const lastCool=last('cool_check');
    const deadline=Math.min(...base.trays.filter(t=>!t.cold).map(t=>t.first20?t.deadline2:t.deadline1).filter(t=>t!=null));
    base.nextDue=Math.min((lastCool?.at??cooler?.at??out)+30*MIN,deadline);
    return {...base,status:cooler?'cooling':'transfer',title:cooler?'Cooling in fridge':'Move trays into the cooler'};
  }
  function validateStore(x) {
    if(!x||x.schema!==1||!Array.isArray(x.batches)||x.batches.length>2000)throw Error('This is not a supported wing-log backup.');
    const batchIds=new Set();
    for(const b of x.batches) {
      if(typeof b.id!=='string'||batchIds.has(b.id)||typeof b.name!=='string'||!Number.isFinite(b.createdAt)||!['normal','existing'].includes(b.mode)||!Array.isArray(b.trays)||b.trays.length<1||b.trays.length>12||!Array.isArray(b.events)||b.events.length>10000)throw Error('The backup has an invalid batch.');
      batchIds.add(b.id);const trayIds=new Set();
      for(const t of b.trays){if(typeof t.id!=='string'||trayIds.has(t.id)||typeof t.label!=='string'||t.label.length>100)throw Error('Invalid tray labels.');trayIds.add(t.id);}
      const ids=new Set();
      for(const e of b.events){
        if(!e||!TYPES.has(e.type)||typeof e.id!=='string'||ids.has(e.id)||!Number.isFinite(e.at)||!Number.isFinite(e.enteredAt)||e.at<0||e.enteredAt<0)throw Error('Invalid record in the backup.');
        ids.add(e.id);if(e.tray&&!trayIds.has(e.tray))throw Error('Unknown tray in backup.');
        if(['cook_check','cool_check'].includes(e.type)&&!e.tray)throw Error('Missing tray on temperature record.');
        if(['raw_check','cook_check','cook_batch_check','cool_check'].includes(e.type)&&(!Number.isFinite(e.c)||e.c< -40||e.c>120))throw Error('Invalid temperature record.');
        if(['cook_check','cook_batch_check'].includes(e.type)&&typeof e.held15!=='boolean')throw Error('Missing cooking confirmation.');
        if(e.type==='clock_fix'&&(!Number.isFinite(e.valueAt)||!e.reason))throw Error('Invalid clock correction.');
        if(e.type==='void'&&(!e.ref||!e.reason))throw Error('Invalid correction record.');
        if(e.note!=null&&typeof e.note!=='string')throw Error('Invalid note.');
      }
    }
    return x;
  }
  function mergeStores(a,b) {
    validateStore(a);validateStore(b);const merged=JSON.parse(JSON.stringify(a));
    for(const next of b.batches){const old=merged.batches.find(v=>v.id===next.id);if(!old){merged.batches.push(next);continue;}
      if(JSON.stringify(old.trays)!==JSON.stringify(next.trays)||old.name!==next.name||old.mode!==next.mode)throw Error('A batch has conflicting details. Nothing was imported.');
      for(const e of next.events){const existing=old.events.find(v=>v.id===e.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(e))throw Error('Conflicting record found. Nothing was imported.');if(!existing)old.events.push(e);}
    }
    validateStore(merged);return merged;
  }
  function csv(store) {
    const rows=[['Batch ID','Batch','Tray / shelf','Event','Actual time (Toronto)','Actual time (UTC)','Entered time (UTC)','Wing core C','15 seconds confirmed','Staff','Note / correction','Original record ID','Record ID','Corrected / voided']];
    for(const b of store.batches){const voids=new Set(b.events.filter(e=>e.type==='void').map(e=>e.ref));for(const e of b.events)rows.push([b.id,b.name,b.trays.find(t=>t.id===e.tray)?.label??'',e.type,localDateTime(e.type==='clock_fix'?e.valueAt:e.at),new Date(e.type==='clock_fix'?e.valueAt:e.at).toISOString(),new Date(e.enteredAt).toISOString(),e.c??'',e.held15==null?'':e.held15?'Yes':'No',e.staff??'',e.note??e.reason??'',e.ref??'',e.id,voids.has(e.id)?'Yes':'']);}
    return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v);if(typeof v!=='number'&&/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
  }
  const api={MIN,HOUR,uid,event,active,temperature,fmt,localTime,localDateTime,localInput,parseLocal,evaluate,validateStore,mergeStores,csv};
  root.WingCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
