import {describe,expect,it} from "vitest";
import {leadColor,LEAD_COLORS} from "@/lib/lead-colors";
describe("cores dos contatos",()=>{
  it("separa não contatado, contatado e sem número",()=>{
    expect(leadColor({contacted:false,phone_e164:"+5511999999999"})).toBe(LEAD_COLORS.novos);
    expect(leadColor({contacted:true,phone_e164:"+5511999999999"})).toBe(LEAD_COLORS.contatados);
    expect(leadColor({contacted:false,phone_e164:null})).toBe(LEAD_COLORS.sem_numero);
    expect(leadColor({contacted:true,phone_e164:null})).toBe(LEAD_COLORS.contatados);
  });
});
