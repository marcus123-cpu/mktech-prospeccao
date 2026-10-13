export type Demonstration = {
  id:string;name:string;kind:"video"|"link";category:string;description:string;
  approved:boolean;available:boolean;scopes:string[];match_terms:string[];
  offer:string;caption:string;url?:string;format:string;last_verified_at?:string;
};
export type DemoHistory = {demonstration_id:string;status:string;sent_at:string|null};
const norm=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
/** Catálogo fornece categorias e termos: adicionar material não exige mudar o prompt. */
export function selectDemonstration(catalog:Demonstration[],inputs:string[],scope?:string|null):Demonstration|undefined {
  const approved=catalog.filter(d=>d.approved);
  for(const input of [...inputs].reverse()) {
    const n=norm(input);
    const match=approved.find(d=>d.match_terms.some(term=>n.includes(norm(term))));
    if(match)return match;
  }
  return approved.find(d=>scope && d.scopes.includes(scope)) ?? approved.find(d=>d.scopes.includes("landing_page")) ?? approved[0];
}
