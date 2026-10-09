import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * O painel roda no mesmo PC do Hermes. Ao pedir mensagens, dispara na hora o
 * gerar-abordagens.bat (que só chama o Hermes se houver pedido pendente), sem
 * esperar a tarefa de 15 em 15 minutos. Caminho fixo, sem nada vindo do usuário.
 * Em outro ambiente (sem Windows ou sem o .bat) não faz nada.
 */
export function startApproachNow(): boolean {
  if (process.platform !== "win32") return false;
  const bat = path.join(process.cwd(), "gerar-abordagens.bat");
  if (!existsSync(bat)) return false;
  try {
    const child = spawn("cmd.exe", ["/d", "/c", bat], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
