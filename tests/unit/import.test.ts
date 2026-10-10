import { describe, expect, it } from "vitest";
import { buildRows, guessMapping, parseContacted, parseSiteCheck, toCsv } from "@/lib/import";

describe("importação da planilha", () => {
  const headers = ["Cliente", "Telefone / WhatsApp", "Contatado?", "Cidade", "Instagram", "Link do WhatsApp", "Verificação de site", "Observações"];

  it("sugere o mapeamento das colunas conhecidas", () => {
    expect(guessMapping(headers)).toEqual({
      business_name: 0,
      phone: 1,
      contacted: 2,
      city: 3,
      instagram: 4,
      whatsapp_url: 5,
      site_check: 6,
      notes: 7,
    });
  });

  it("'Sim' é contatado, 'Não' não, vazio é desconhecido", () => {
    expect(parseContacted("Sim")).toBe("sim");
    expect(parseContacted(" não ")).toBe("nao");
    expect(parseContacted("")).toBeNull();
    expect(parseContacted("talvez")).toBeNull();
  });

  it("nunca transforma texto ambíguo em 'sem site'", () => {
    expect(parseSiteCheck("Não possui site").status).toBe("site_nao_localizado");
    expect(parseSiteCheck("Só Instagram / linktree").status).toBe("apenas_redes_sociais");
    expect(parseSiteCheck("https://clinica.com.br")).toEqual({ status: "site_proprio_encontrado", website_url: "https://clinica.com.br" });
    expect(parseSiteCheck("ver depois").status).toBe("verificacao_pendente");
    expect(parseSiteCheck("").status).toBe("verificacao_pendente");
  });

  it("monta linhas, ignora vazias e marca desqualificados", () => {
    const rows = buildRows(
      [
        ["Bella Estética", "(17) 99999-1111", "Sim", "Votuporanga", "@bella", "https://wa.me/5517999991111", "não tem site", ""],
        ["", "", "", "", "", "", "", ""],
        ["Ana Pele", "17 98888-2222", "", "", "", "texto", "talvez", "Não atua mais na área"],
      ],
      guessMapping(headers),
      "Fernandópolis",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ contacted: "sim", site_status: "site_nao_localizado", city: "Votuporanga" });
    expect(rows[1].city).toBe("Fernandópolis");
    expect(rows[1].whatsapp_url).toBeUndefined();
    expect(rows[1].disqualify_reason).toBe("Não atua mais na área");
    expect(rows[1].notes).toContain("Verificação de site (planilha): talvez");
    expect(rows[1].phone).toBe("17 98888-2222");
  });

  it("CSV protege contra fórmulas sem estragar telefones", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(1)", "+55 17 99999-0000"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain(`"+55 17 99999-0000"`);
  });
});
