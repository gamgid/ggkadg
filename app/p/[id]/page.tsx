// Static preview only; this route does not share browser-local data.
export const dynamicParams = false;
export function generateStaticParams() { return [{ id: 'demo-profile' }]; }
import SharedDemoProfile from './profile';
export default async function ProfilePage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <SharedDemoProfile id={id}/>}
