// Confere se nenhum segredo do servidor foi parar nos arquivos enviados ao navegador.
// Uso: npm run build && node scripts/verificar-segredos.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(".next/static");
const secrets = [process.env.SUPABASE_SERVICE_ROLE_KEY].filter((v) => v && v.length > 10);
const patterns = [/SUPABASE_SERVICE_ROLE_KEY/, /service_role/, /mkt_[a-f0-9]{64}/, /api_register_candidate/, /token_hash/];

function* walk(d) {
  for (const name of readdirSync(d)) {
    const p = path.join(d, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const found = [];
for (const file of walk(dir)) {
  const text = readFileSync(file, "utf8");
  for (const s of secrets) if (text.includes(s)) found.push(`${file}: valor de SUPABASE_SERVICE_ROLE_KEY`);
  for (const re of patterns) if (re.test(text)) found.push(`${file}: ${re}`);
}
if (found.length) {
  console.error("Possível segredo no código do navegador:\n" + found.join("\n"));
  process.exit(1);
}
console.log(`OK: nenhum segredo em ${dir}`);
