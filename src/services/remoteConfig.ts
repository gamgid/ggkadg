export type WatermarkMode = 0 | 1;

const DEFAULT_WATERMARK_MODE:WatermarkMode=1;

export async function loadWatermarkMode(profileId:string):Promise<WatermarkMode>{
  const projectUrl=process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'');
  const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const normalizedProfileId=profileId.trim();
  if(!projectUrl||!anonKey||!normalizedProfileId)return DEFAULT_WATERMARK_MODE;

  const controller=new AbortController();
  // A free Supabase project can need a few seconds to wake up after inactivity.
  // Keep the safe fallback, but do not abandon a valid request too early.
  const timeout=window.setTimeout(()=>controller.abort(),10000);
  try{
    const query=new URLSearchParams({select:'watermark_mode',profile_id:`eq.${normalizedProfileId}`,limit:'1'});
    const response=await fetch(`${projectUrl}/rest/v1/profile_visuals?${query.toString()}`,{
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
