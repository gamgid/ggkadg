export type WatermarkMode = 0 | 1;
export type RemoteConfigStatus =
  | 'checking'
  | 'ok'
  | 'missing-config'
  | 'not-found'
  | 'unauthorized'
  | 'forbidden'
  | 'missing-table'
  | 'invalid-url'
  | 'rate-limited'
  | 'http-error'
  | 'timeout'
  | 'network-error'
  | 'invalid-data';

export type RemoteConfigResult = {
  mode: WatermarkMode;
  status: RemoteConfigStatus;
  httpStatus?: number;
  errorCode?: string;
};

const DEFAULT_WATERMARK_MODE:WatermarkMode=1;

function normalizeProjectUrl(value:string|undefined):string|undefined{
  if(!value)return undefined;
  try{
    const url=new URL(value.trim());
    if(url.protocol!=='https:'&&url.protocol!=='http:')return undefined;
    // GitHub Secret should contain the Project URL, but accepting a copied
    // REST endpoint as well prevents /rest/v1/rest/v1/... and PGRST125.
    return url.origin;
  }catch{
    return undefined;
  }
}

export async function loadWatermarkMode(profileId:string):Promise<RemoteConfigResult>{
  const projectUrl=normalizeProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const apiKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const normalizedProfileId=profileId.trim();
  if(!projectUrl||!apiKey||!normalizedProfileId){
    return {mode:DEFAULT_WATERMARK_MODE,status:'missing-config'};
  }

  const controller=new AbortController();
  // A free Supabase project can need a few seconds to wake up after inactivity.
  // Keep the safe fallback, but do not abandon a valid request too early.
  const timeout=window.setTimeout(()=>controller.abort(),10000);
  try{
    const query=new URLSearchParams({select:'watermark_mode',profile_id:`eq.${normalizedProfileId}`,limit:'1'});
    const response=await fetch(`${projectUrl}/rest/v1/profile_visuals?${query.toString()}`,{
      // Publishable keys are API keys, not JWTs. Sending one as a Bearer
      // token makes Supabase reject the request with "Invalid JWT".
      // The apikey header works with both current publishable keys and the
      // legacy JWT-based anon keys for unauthenticated RLS reads.
      headers:{apikey:apiKey},
      cache:'no-store',
      signal:controller.signal,
    });
    if(!response.ok){
      let errorCode:string|undefined;
      try{
        const body=await response.json() as {code?:unknown};
        if(typeof body.code==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(body.code))errorCode=body.code;
      }catch{}
      const status:RemoteConfigStatus=
        response.status===401?'unauthorized':
        response.status===403?'forbidden':
        response.status===429?'rate-limited':
        errorCode==='PGRST125'?'invalid-url':
        errorCode==='PGRST205'||errorCode==='42P01'?'missing-table':
        'http-error';
      return {mode:DEFAULT_WATERMARK_MODE,status,httpStatus:response.status,errorCode};
    }
    const rows=await response.json() as Array<{watermark_mode?:unknown}>;
    if(rows.length===0)return {mode:DEFAULT_WATERMARK_MODE,status:'not-found'};
    if(rows[0]?.watermark_mode!==0&&rows[0]?.watermark_mode!==1){
      return {mode:DEFAULT_WATERMARK_MODE,status:'invalid-data'};
    }
    return {mode:rows[0].watermark_mode,status:'ok'};
  }catch(error){
    return {
      mode:DEFAULT_WATERMARK_MODE,
      status:error instanceof DOMException&&error.name==='AbortError'?'timeout':'network-error',
    };
  }finally{
    window.clearTimeout(timeout);
  }
}
