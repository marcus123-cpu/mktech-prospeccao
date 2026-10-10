import { describe, expect, it } from "vitest";
import { sugestoesResposta } from "@/lib/envio/sugestoes";

describe("sugestões de resposta", () => {
  const s = sugestoesResposta({ nome: "Ana Souza", negocio: "Clínica Aurora" });
  it("traz as quatro situações e usa o primeiro nome", () => {
    expect(s.map((x) => x.id)).toEqual(["aceitou", "como-funciona", "valor", "sem-interesse"]);
    expect(s[0].texto).toContain("Ana,");
    expect(s[0].texto).toContain("Clínica Aurora");
  });
  it("nunca cita preço", () => {
    for (const x of s) expect(x.texto).not.toMatch(/r\$|\d+\s*reais|\d+,\d{2}/i);
  });
  it("funciona sem nome", () => {
    expect(sugestoesResposta({})[0].texto).toContain("seu negócio");
  });
});
