import {describe,it,expect,vi} from "vitest";
import {researchSchema} from "@/lib/research";
import {attachmentMime, MAX_ATTACHMENT_BYTES} from "@/lib/attachments";
import {applyLeadFilters} from "@/lib/leads-query";
describe("workspace filters and research instructions",()=>{
 it("keeps observations on the validated research request",()=>{
  const request={niche:"Academia",scope:"brasil",target:20,observations:"Conferir a bio do Instagram e o domínio do site."};
  expect(researchSchema.parse(request).observations).toBe(request.observations);
  expect(researchSchema.safeParse({...request,observations:"x".repeat(3001)}).success).toBe(false);
 });
 it("filters each dashboard category in the database",()=>{
  const query={eq:vi.fn().mockReturnThis(),is:vi.fn().mockReturnThis(),not:vi.fn().mockReturnThis(),like:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis()};
  applyLeadFilters(query,{categoria:"novos",nicho:"Academia"});
  expect(query.eq).toHaveBeenCalledWith("contacted",false);expect(query.eq).toHaveBeenCalledWith("niche","Academia");
  applyLeadFilters(query,{categoria:"instagram"});expect(query.is).toHaveBeenCalledWith("phone_e164",null);expect(query.not).toHaveBeenCalledWith("instagram_handle","is",null);
  applyLeadFilters(query,{categoria:"fixo"});expect(query.like).toHaveBeenCalledWith("phone_e164","+55__________");
 });
 it("accepts supported files and rejects executable uploads",()=>{
  expect(attachmentMime("video.MP4")).toBe("video/mp4");expect(attachmentMime("proposta.pdf")).toBe("application/pdf");
  expect(attachmentMime("virus.exe")).toBeNull();expect(MAX_ATTACHMENT_BYTES).toBe(31457280);
 });
});
