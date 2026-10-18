"use client";
import Link from "next/link";
import {useState, type ComponentProps} from "react";
/** Prefetch on intent, instead of issuing requests for every row in the inbox. */
export function ConversationLink({leadId,name,active,children,...props}: ComponentProps<typeof Link> & {leadId: string;name: string;active: boolean}) {
  const [intent,setIntent]=useState(false);
  return <Link {...props} prefetch={intent} onPointerEnter={()=>setIntent(true)} onFocus={()=>setIntent(true)}
    onClick={event=>{
      if(!active&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){
        window.dispatchEvent(new CustomEvent("mktech:conversation-opening",{detail:{id:leadId,name}}));
      }
    }}>{children}</Link>;
}
