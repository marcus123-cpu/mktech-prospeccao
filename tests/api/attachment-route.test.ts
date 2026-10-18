import {beforeEach,describe,it,expect,vi} from "vitest";
const requireAdmin=vi.fn(), rpc=vi.fn(), lookup=vi.fn(), insert=vi.fn(), signed=vi.fn(), list=vi.fn();
vi.mock("@/lib/auth",()=>({requireAdmin}));
vi.mock("@/lib/supabase/admin",()=>({serviceClient:()=>({from:()=>({insert}),storage:{from:()=>({createSignedUploadUrl:signed,list})}})}));
const {POST}=await import("@/app/api/conversas/anexos/route");
const id="11111111-1111-4111-8111-111111111111";
const request=(body:unknown,origin="http://localhost")=>new Request("http://localhost/api/conversas/anexos",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
describe("attachment uploads",()=>{
 beforeEach(()=>{vi.clearAllMocks();requireAdmin.mockResolvedValue({supabase:{from:()=>({select:()=>({eq:()=>({maybeSingle:lookup})})}),rpc}});lookup.mockResolvedValue({data:{phone_e164:"+5511999999999",do_not_contact:false}});signed.mockResolvedValue({data:{token:"test"}});insert.mockResolvedValue({error:null});});
 it("checks origin and file type before allocating storage",async()=>{
  expect((await POST(request({action:"prepare",lead_id:id,filename:"x.pdf",bytes:20},"https://other.example"))).status).toBe(403);
  expect(requireAdmin).not.toHaveBeenCalled();
  expect((await POST(request({action:"prepare",lead_id:id,filename:"x.exe",bytes:20}))).status).toBe(415);
  expect(signed).not.toHaveBeenCalled();
 });
 it("prepares a private direct upload without queueing a message",async()=>{
  const r=await POST(request({action:"prepare",lead_id:id,filename:"video.mp4",bytes:5000000}));
  expect(r.status).toBe(201);expect(insert).toHaveBeenCalledWith(expect.objectContaining({lead_id:id,mime:"video/mp4",bytes:5000000}));expect(rpc).not.toHaveBeenCalled();
 });
 it("does not queue an incomplete or oversized upload",async()=>{
  lookup.mockResolvedValue({data:{id,storage_path:`${id}/original`,bytes:10,mime:"application/pdf"}});
  list.mockResolvedValue({data:[{name:"original",metadata:{size:9,mimetype:"application/pdf"}}]});
  expect((await POST(request({action:"send",id}))).status).toBe(422);expect(rpc).not.toHaveBeenCalled();
  expect((await POST(request({action:"prepare",lead_id:id,filename:"x.pdf",bytes:31457281}))).status).toBe(422);
 });
 it("queues only the verified uploaded object",async()=>{
  lookup.mockResolvedValue({data:{id,storage_path:`${id}/original`,bytes:10,mime:"application/pdf"}});
  list.mockResolvedValue({data:[{name:"original",metadata:{size:10,mimetype:"application/pdf"}}]});rpc.mockResolvedValue({error:null});
  expect((await POST(request({action:"send",id}))).status).toBe(201);expect(rpc).toHaveBeenCalledExactlyOnceWith("admin_send_attachment",{p_id:id});
 });
});
