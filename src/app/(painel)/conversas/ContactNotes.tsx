"use client";
import {useEffect,useState} from "react";
import dynamic from "next/dynamic";
import type {Diagnosis} from "@/components/leads/DiagnosisCard";
import {MemoryForm,type Memory} from "./MemoryForm";
const DiagnosisCard=dynamic(()=>import("@/components/leads/DiagnosisCard").then(m=>m.DiagnosisCard),{loading:()=> <p className="text-xs text-muted">Carregando diagnóstico…</p>});
export function ContactNotes({leadId}: {leadId: string}) {
  const [data,setData]=useState<{memory:Memory|null;diagnosis:Diagnosis|null}|null>(null);
  const [error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setData(null);setError(false);
    fetch(`/api/conversas/info/${leadId}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{
      if(!r.ok)throw Error();const next=await r.json();if(!controller.signal.aborted)setData(next);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();
  },[leadId,attempt]);
  if(error)return <button className="btn-ghost" onClick={()=>setAttempt(n=>n+1)}>Tentar carregar informações novamente</button>;
  if(!data)return <p role="status" className="text-sm text-muted">Carregando informações do contato…</p>;
  return <><details className="card p-4"><summary className="cursor-pointer font-semibold">Memória do cliente</summary><div className="mt-4"><MemoryForm leadId={leadId} memory={data.memory}/></div></details><DiagnosisCard d={data.diagnosis} olderCount={0}/></>;
}
