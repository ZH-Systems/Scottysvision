import {connectorsForRequest} from './connectors';
import {chatGPTSignInPath} from '../app/chatgpt-auth';
import {AppError} from './vision-server';
export const SHEET='1RANOtM1E7cxyyLA2_QMSS6WgqRc3PlWrIcIARTZA5ng';
export const CONNECTOR='connector_5f3c8c41a1e54ad7a76272c89e2554fa';
export class ConnectionError extends AppError{constructor(public result:any){super(502,result.message||'Vision could not confirm the Google Sheets response.')}}
export async function invoke(action:string,args:any){const r=await connectorsForRequest().invoke(CONNECTOR,action,args);if(r.status!=='success')throw new ConnectionError(r);const content=r.result.structuredContent;if(content!==undefined)return content as any;for(const block of r.result.content||[])if(block.type==='text'&&typeof block.text==='string'){try{return JSON.parse(block.text)}catch{}}throw new AppError(502,'Google Sheets returned no readable result.');}
export async function metadata(){return invoke('get_spreadsheet_metadata',{spreadsheet_id:SHEET});}
export async function range(name:string,cells:string){return invoke('get_spreadsheet_range',{spreadsheet_id:SHEET,sheet_name:name,range:cells,value_render_option:'UNFORMATTED_VALUE'});}
export function requireTab(meta:any,name:string,minColumns:number){const p=meta.sheets?.find((x:any)=>x.properties?.title===name)?.properties;if(!p||p.gridProperties?.columnCount<minColumns)throw new AppError(409,'Vision tab '+name+' is missing or changed. Review the workbook before posting.');return p;}
export function connectionFailure(e:unknown){if(e instanceof ConnectionError){const r=e.result;return Response.json({...r,...(r.status==='reauthentication_required'?{signIn:chatGPTSignInPath('/kitchen.html#sync')}:{})},{status:502,headers:{'Cache-Control':'private, no-store'}});}return null;}
