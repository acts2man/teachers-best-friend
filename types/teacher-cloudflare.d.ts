interface D1Result<T=unknown>{results:T[];success:boolean;meta:{changes:number;duration:number;last_row_id:number;changed_db:boolean;size_after:number;rows_read:number;rows_written:number};error?:string}
interface D1PreparedStatement{bind(...values:unknown[]):D1PreparedStatement;first<T=unknown>(columnName?:string):Promise<T|null>;all<T=unknown>():Promise<D1Result<T>>;run<T=unknown>():Promise<D1Result<T>>;raw<T=unknown>(options?:{columnNames?:boolean}):Promise<T[]>}
interface D1Database{prepare(query:string):D1PreparedStatement;batch<T=unknown>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>;exec(query:string):Promise<{count:number;duration:number}>;dump():Promise<ArrayBuffer>}
interface Fetcher{fetch(request:Request|string,init?:RequestInit):Promise<Response>}
interface TeacherR2Object{body:ReadableStream<Uint8Array>;arrayBuffer():Promise<ArrayBuffer>;size:number}
interface TeacherR2Bucket{put(key:string,data:ArrayBuffer|Uint8Array|ReadableStream,options?:{httpMetadata?:{contentType?:string}}):Promise<unknown>;get(key:string):Promise<TeacherR2Object|null>;delete(key:string|string[]):Promise<void>}
declare module "cloudflare:workers"{export const env:{DB:D1Database;BUCKET:TeacherR2Bucket;OPENAI_API_KEY?:string;OPENAI_MODEL?:string}}
