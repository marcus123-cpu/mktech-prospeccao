import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync('scripts/v6-migration-tail.sql','utf8');
const names=['api_commercial_v6_contexts','api_commercial_v6_save'];
const definitions=names.map(name=>{const start=source.indexOf(`create function public.${name}(`);if(start<0)throw new Error(name);return source.slice(start,source.indexOf('end $$;',start)+7).replace('create function','create or replace function');});
writeFileSync('supabase/migrations/20261013220000_contexto_provisorio_v6.sql','-- Transporte não é interpretação semântica.\n'+definitions.join('\n'));
