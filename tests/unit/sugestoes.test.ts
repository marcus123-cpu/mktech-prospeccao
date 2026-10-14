import { describe, expect, it } from "vitest";
import { sugestoesResposta } from "@/lib/envio/sugestoes";

describe("sugestões de resposta", () => {
  const s = sugestoesResposta({ nome: "Ana Souza", negocio: "Clínica Aurora" });
  it("traz as situações do fluxo e usa o primeiro nome", () => {
    expect(s.map((x) => x.id)).toEqual(["recepcao", "aceitou", "como-funciona", "valor", "ja-tem-site", "sem-interesse"]);
    const aceitou = s.find((x) => x.id === "aceitou")!;
    expect(aceitou.texto).toContain("Ana,");
    expect(aceitou.texto).toContain("Clínica Aurora");
  });
  it("nunca sugere reunião ou ligação", () => {
    for (const x of s) expect(x.texto).not.toMatch(/liga[çc][ãa]o|reuni[ãa]o|call/i);
  });
  it("nunca cita preço", () => {
    for (const x of s) expect(x.texto).not.toMatch(/r\$|\d+\s*reais|\d+,\d{2}/i);
  });
  it("funciona sem nome", () => {
    expect(sugestoesResposta({}).find((x) => x.id === "aceitou")!.texto).toContain("seu negócio");
  });
});
