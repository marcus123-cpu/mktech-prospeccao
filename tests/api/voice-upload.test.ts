import { describe,it,expect,vi,beforeEach } from "vitest";
const rpc=vi.fn(), upload=vi.fn(), remove=vi.fn(), lookup=vi.fn();
vi.mock("@/lib/auth",()=>({requireAdmin:async()=>({supabase:{rpc,from:()=>({select:()=>({eq:()=>({maybeSingle:lookup})})})}})}));
vi.mock("@/lib/supabase/admin",()=>({serviceClient:()=>({storage:{from:()=>({upload,remove})}})}));
const {POST}=await import("@/app/api/conversas/voz/route");
const lead="11111111-1111-4111-8111-111111111111";
function req(file=new File(["fake audio"],"voice.mp3",{type:"audio/mpeg"}),origin="http://localhost") {
  const form=new FormData();form.set("lead_id",lead);form.set("audio",file);
  return new Request("http://localhost/api/conversas/voz",{method:"POST",headers:{origin},body:form});
}
describe("voice upload",()=>{
  beforeEach(()=>{vi.clearAllMocks();lookup.mockResolvedValue({data:{phone_e164:"+5517991234567",do_not_contact:false}});upload.mockResolvedValue({error:null});rpc.mockResolvedValue({error:null});});
  it("stores private audio then queues it using the admin session",async()=>{
    expect((await POST(req())).status).toBe(201);
    expect(upload).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("admin_send_voice_reply",expect.objectContaining({p_lead:lead,p_mime:"audio/mpeg",p_bytes:10}));
  });
  it("blocks cross-origin requests, oversized files and unsupported types",async()=>{
    expect((await POST(req(undefined,"https://other.test"))).status).toBe(403);
    expect((await POST(req(new File([new Uint8Array(3*1024*1024+1)],"large.mp3")))).status).toBe(413);
    expect((await POST(req(new File(["bad"],"bad.pdf")))).status).toBe(415);
    expect(upload).not.toHaveBeenCalled();
  });
  it("does not upload to blocked contacts and removes orphaned files",async()=>{
    lookup.mockResolvedValueOnce({data:{phone_e164:"+5517991234567",do_not_contact:true}});
    expect((await POST(req())).status).toBe(422);expect(upload).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({error:{message:"failure"}});
    expect((await POST(req())).status).toBe(503);expect(remove).toHaveBeenCalledOnce();
  });
});
