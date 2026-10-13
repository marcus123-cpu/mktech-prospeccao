export function validTimezone(value:string|null|undefined):string|null {
  if(!value)return null;
  try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return value;}catch{return null;}
}
/** Só inferir cidade/fuso quando há localização confirmada. Demais localidades exigem IANA explícito. */
export function recipientTimezone(explicit:string|null|undefined,state:string|null|undefined):string|null {
  if(explicit)return validTimezone(explicit);
  return state?.toUpperCase()==='SP' ? 'America/Sao_Paulo' : null;
}
export function greetingAt(now:string,timezone:string):string {
  if(!validTimezone(timezone))throw new Error('Fuso inválido');
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'numeric',hourCycle:'h23'}).format(new Date(now)));
  return `Olá, ${hour>=5&&hour<12?'bom dia':hour>=12&&hour<18?'boa tarde':'boa noite'}! Tudo bem?`;
}
