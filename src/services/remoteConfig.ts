export type WatermarkMode = 0 | 1;

const DEFAULT_WATERMARK_MODE:WatermarkMode=1;
const CONFIG_ID='main';

export async function loadWatermarkMode():Promise<WatermarkMode>{
  const projectUrl=process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'');
  const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!projectUrl||!anonKey)return DEFAULT_WATERMARK_MODE;

  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch(`${projectUrl}/rest/v1/app_config?select=watermark_mode&id=eq.${CONFIG_ID}&limit=1`,{
      headers:{apikey:anonKey,Authorization:`Bearer ${anonKey}`},
      cache:'no-store',
      signal:controller.signal,
    });
    if(!response.ok)return DEFAULT_WATERMARK_MODE;
    const rows=await response.json() as Array<{watermark_mode?:unknown}>;
    return rows[0]?.watermark_mode===0?0:DEFAULT_WATERMARK_MODE;
  }catch{
    return DEFAULT_WATERMARK_MODE;
  }finally{
    window.clearTimeout(timeout);
  }
}
