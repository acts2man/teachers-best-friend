import { headers } from "next/headers";
async function runtimeEnv() {
  try {
    return (await import("cloudflare:workers")).env;
  } catch {
    throw new HttpError(503,"Classroom sign-in and storage are not connected on this host yet. Please use the original private app until setup is complete.");
  }
}
type Statement={bind:(...values:unknown[])=>Statement;first:<T=Record<string,unknown>>()=>Promise<T|null>;all:<T=Record<string,unknown>>()=>Promise<{results:T[]}>;run:()=>Promise<{meta:{changes:number}}>};
type Binding={prepare:(sql:string)=>Statement;batch:(s:Statement[])=>Promise<unknown>};
export async function database():Promise<Binding>{const env=await runtimeEnv();if(!env.DB)throw new Error("Storage is temporarily unavailable.");return env.DB as unknown as Binding}
export async function bucket(){const env=await runtimeEnv();if(!env.BUCKET)throw new Error("Document storage is temporarily unavailable.");return env.BUCKET}
export async function owner(){await runtimeEnv();const h=await headers();const id=h.get("oai-authenticated-user-id");if(!id)throw new HttpError(401,"Please sign in to open your classroom.");return id}
export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export function guardOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)throw new HttpError(403,"This request could not be verified.")}
export function apiError(e:unknown){if(e instanceof HttpError)return Response.json({error:e.message},{status:e.status});console.error("Teacher workspace request failed",e instanceof Error?e.name:"unknown");return Response.json({error:"We couldn’t complete that request. Your changes haven’t been discarded. Please try again."},{status:503})}
export async function aiConfig(){const e=await runtimeEnv() as unknown as Record<string,string>;return {key:e.OPENAI_API_KEY||"",model:e.OPENAI_MODEL||"gpt-6-astra"}}
export async function readWorkspace(id:string){const row=await (await database()).prepare("SELECT data,revision FROM teacher_workspaces WHERE owner_id=?").bind(id).first<{data:string;revision:number}>();return row?{data:JSON.parse(row.data),revision:row.revision}:null}
