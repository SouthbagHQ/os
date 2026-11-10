import { beforeEach, afterEach, expect, test } from "bun:test";
import { beginLogin, completeLogin, redirectUri } from "./oidc";
import { base64url, challengeFor } from "./pkce";

// Credential-free synthetic issuer. No server, browser navigation or network.
const ISS = "http://127.0.0.1:41999";
const PENDING = "southbag.identity.pending";
const SESSION = "southbag.session";
const saved = new Map<string, PropertyDescriptor | undefined>();
let calls: { url: string; init?: RequestInit }[];
let pending: Record<string, unknown>;
let claims: Record<string, unknown>;
let assigned: string;
let tokenStatus: number;
let nonceToken: string;
let jwks: object;
let signer: CryptoKey;
function storage() {
 const map = new Map<string,string>();
 return { getItem:(key:string)=>map.get(key)??null, setItem:(key:string,value:string)=>{map.set(key,String(value));}, removeItem:(key:string)=>{map.delete(key);} };
}
function globalValue(key:string,value:unknown) {
 saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
 Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
}
async function signed(extraSegment=false, badSignature=false) {
 const head=base64url(new TextEncoder().encode(JSON.stringify({alg:"EdDSA",kid:"synthetic"})));
 const body=base64url(new TextEncoder().encode(JSON.stringify(claims)));
 const signature=new Uint8Array(await crypto.subtle.sign("Ed25519",signer,new TextEncoder().encode(`${head}.${body}`)));
 if(badSignature)signature[0]=signature[0]!^1;
 return `${head}.${body}.${base64url(signature)}${extraSegment?".extra":""}`;
}
function seed(change:Record<string,unknown>={}) { sessionStorage.setItem(PENDING,JSON.stringify({...pending,...change})); }
function callback(search="?code=synthetic-code&state=state-A") { (globalThis.location as unknown as {search:string}).search=search; }
beforeEach(async()=>{
 calls=[];assigned="";tokenStatus=200;nonceToken="";
 pending={verifier:"A".repeat(43),state:"state-A",nonce:"nonce-A",clientId:"client-A",redirect:"http://127.0.0.1:8080/",iss:ISS,createdAt:Date.now()};
 claims={iss:ISS,sub:"synthetic-subject",aud:"client-A",exp:Math.floor(Date.now()/1000)+60,nonce:"nonce-A"};
 const keys=await crypto.subtle.generateKey("Ed25519",true,["sign","verify"]) as CryptoKeyPair;signer=keys.privateKey;
 jwks={keys:[{...await crypto.subtle.exportKey("jwk",keys.publicKey),kid:"synthetic"}]};
 globalValue("localStorage",storage());globalValue("sessionStorage",storage());
 globalValue("location",{search:"",origin:"http://127.0.0.1:8080",assign:(url:string)=>{assigned=url;}});
 globalValue("history",{replaceState:()=>{}});
 globalValue("fetch",async(input:RequestInfo | URL,init?:RequestInit)=>{
  const url=String(input);calls.push({url,init});
  if(!url.startsWith(ISS+"/api/auth/"))throw new Error("test blocked non-fixture egress");
  if(url.endsWith("/oauth2/register"))return Response.json({client_id:"client-A"});
  if(url.endsWith("/oauth2/token"))return Response.json(tokenStatus===200?{id_token:nonceToken||await signed(),access_token:"synthetic-access"}:{error:"invalid_grant"},{status:tokenStatus});
  if(url.endsWith("/jwks"))return Response.json(jwks);
  throw new Error("test blocked unknown fixture route");
 });
 pending.redirect=redirectUri();
 seed();callback();
});
afterEach(()=>{for(const[key,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}saved.clear();});
async function refuses(pattern?:RegExp) {
 await expect(completeLogin()).rejects.toThrow(pattern);
 expect(localStorage.getItem(SESSION)).toBeNull();
}
test("state mismatch consumes pending and performs no exchange",async()=>{callback("?code=x&state=wrong");await refuses(/state/);expect(calls).toHaveLength(0);expect(sessionStorage.getItem(PENDING)).toBeNull();});
test("missing state is rejected before exchange",async()=>{callback("?code=x");await refuses(/state/);expect(calls).toHaveLength(0);});
test("callback issuer mismatch makes no token request",async()=>{callback("?code=x&state=state-A&iss=https%3A%2F%2Fwrong.invalid");await refuses(/issuer/);expect(calls).toHaveLength(0);});
test("expired request is rejected before exchange",async()=>{seed({createdAt:Date.now()-3600001});await refuses(/long/);expect(calls).toHaveLength(0);});
test("future or missing pending timestamp is invalid",async()=>{for(const createdAt of [Date.now()+60000,undefined]){seed({createdAt});await refuses();}expect(calls).toHaveLength(0);});
test("invalid PKCE verifier never reaches token endpoint",async()=>{for(const verifier of ["short","?".repeat(43),"A".repeat(129),undefined]){seed({verifier});await refuses();}expect(calls).toHaveLength(0);});
test("issuer rejects wrong PKCE exchange and callback cannot be replayed",async()=>{tokenStatus=400;await refuses(/exchange/);expect(new URLSearchParams(String(calls[0]!.init?.body)).get("code_verifier")).toBe(pending.verifier as string);await refuses(/no sign-in/);expect(calls).toHaveLength(1);});
test("signed wrong nonce cannot store session",async()=>{claims.nonce="wrong";await refuses(/nonce/);});
test("signed missing nonce cannot store session",async()=>{delete claims.nonce;await refuses(/nonce/);});
test("signed wrong issuer cannot store session",async()=>{claims.iss="https://wrong.invalid";await refuses(/issuer/);});
test("signed wrong audience cannot store session",async()=>{claims.aud="other-client";await refuses(/device/);});
test("multi-audience token must identify authorized party",async()=>{claims.aud=["client-A","other"];await refuses();});
test("expired signed token cannot store session",async()=>{claims.exp=1;await refuses(/expired/);});
test("extra JWT segment cannot be ignored",async()=>{nonceToken=await signed(true);await refuses(/malformed/);});
test("bad signature and unknown key cannot store session",async()=>{nonceToken=await signed(false,true);await refuses(/signature/);seed();nonceToken="";jwks={keys:[]};await refuses(/key/);});
test("valid synthetic callback sends exact PKCE and consumes pending once",async()=>{const session=await completeLogin();expect(session?.customer.sub).toBe("synthetic-subject");expect(localStorage.getItem(SESSION)).not.toBeNull();expect(sessionStorage.getItem(PENDING)).toBeNull();const body=new URLSearchParams(String(calls[0]!.init?.body));expect(body.get("code_verifier")).toBe("A".repeat(43));expect(body.get("redirect_uri")).toBe(pending.redirect as string);});
test("begin uses S256 and unique state/nonce, without navigation",async()=>{sessionStorage.removeItem(PENDING);location.search="?identity="+encodeURIComponent(ISS);await beginLogin();const first=JSON.parse(sessionStorage.getItem(PENDING)!);let url=new URL(assigned);expect(url.origin).toBe(ISS);expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.searchParams.get("code_challenge")).toBe(await challengeFor(first.verifier));expect(url.searchParams.get("code_verifier")).toBeNull();expect(url.searchParams.get("state")).toBe(first.state);expect(url.searchParams.get("nonce")).toBe(first.nonce);await beginLogin();const second=JSON.parse(sessionStorage.getItem(PENDING)!);expect(second.state).not.toBe(first.state);expect(second.nonce).not.toBe(first.nonce);expect(second.verifier).not.toBe(first.verifier);});

test("missing or malformed pending cannot exchange and is consumed",async()=>{sessionStorage.removeItem(PENDING);await refuses(/no sign-in/);sessionStorage.setItem(PENDING,"{");await refuses();expect(sessionStorage.getItem(PENDING)).toBeNull();expect(calls).toHaveLength(0);});
test("wrong callback origin binding rejects before exchange",async()=>{seed({redirect:"http://127.0.0.1:9999/"});await refuses(/transaction/);expect(calls).toHaveLength(0);});
test("signed multiple audience with matching authorized party is accepted",async()=>{claims.aud=["client-A","other"];claims.azp="client-A";expect((await completeLogin())?.customer.sub).toBe("synthetic-subject");});
test("wrong authorized party and malformed subject are refused",async()=>{claims.azp="other";await refuses(/party/);seed();delete claims.azp;claims.sub={value:"not a subject"};await refuses(/subject/);});

for (const age of [600001, 30 * 60 * 1000, 3599000]) {
 test(`valid callback after ${age}ms fits the one-hour window`,async()=>{
  seed({createdAt:Date.now()-age});
  expect((await completeLogin())?.customer.sub).toBe("synthetic-subject");
  expect(calls.filter(call=>call.url.endsWith("/oauth2/token"))).toHaveLength(1);
  expect(sessionStorage.getItem(PENDING)).toBeNull();
 });
}
