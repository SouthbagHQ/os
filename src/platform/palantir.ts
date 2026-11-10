/** The same Palantir collector used by the other Southbag services. */
import type { Customer } from './identity';

type Palantir = {capture:(event:string,properties?:Record<string,unknown>)=>void;identify:(user:{id:string;email?:string;name?:string})=>void;reset:()=>void};
declare global { interface Window { palantir?: Palantir; } }

const queued:Array<[string,Record<string,unknown>]> = [];

export function startAnalytics(customer:Customer|null):void {
 const script=document.createElement('script');
 script.src=import.meta.env.BASE_URL+'palantir.js';
 script.dataset.app='os';
 script.onload=()=>{
  const collector=window.palantir;
  if(collector) for(const [event,properties] of queued.splice(0)) collector.capture(event,properties);
 };
 if(customer){
  script.dataset.userId=customer.sub;
  script.dataset.userEmail=customer.email;
  script.dataset.userName=customer.name;
 }
 document.head.appendChild(script);
}

/** Event properties are authored enums and metadata, never tokens or form bodies. */
export function capture(event:string,properties:Record<string,unknown>={}):void {
 if(window.palantir) window.palantir.capture(event,properties);
 else if(queued.length<100) queued.push([event,properties]);
}
