import {identity,json,fail} from '../../../lib/vision-server';
import {metadata,range,requireTab,connectionFailure} from '../../../lib/vision-connectors';
import {normalizeCatalog} from '../../../public/kitchen-core.mjs';
export const dynamic='force-dynamic';
export async function GET(req:Request){try{await identity(req);const meta=await metadata();const legacy=requireTab(meta,'MASTER INGREDIENTS',9),native=requireTab(meta,'01_INGREDIENTS',23);const [a,b]=await Promise.all([range('MASTER INGREDIENTS','A1:I'+Math.min(legacy.gridProperties.rowCount,2500)),range('01_INGREDIENTS','A1:W'+Math.min(native.gridProperties.rowCount,2000))]);const now=Date.now();return json({status:'success',at:now,source:meta.spreadsheetUrl,items:normalizeCatalog(a.values||[],b.values||[],now),native:(b.values||[]).slice(1).filter((r:any[])=>typeof r[0]==='string').map((r:any[])=>({id:r[0],name:r[1],unit:r[9],active:String(r[20]).toLowerCase()==='yes'}))});}catch(e){return connectionFailure(e)||fail(e)}}
