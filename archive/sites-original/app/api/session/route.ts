import {getChatGPTUser,chatGPTSignInPath} from '../../chatgpt-auth';
export const dynamic='force-dynamic';
export async function GET(){const user=await getChatGPTUser();return Response.json({user:user?{id:user.userId,name:user.displayName}:null,signIn:chatGPTSignInPath('/kitchen.html')},{headers:{'Cache-Control':'private, no-store'}});}
