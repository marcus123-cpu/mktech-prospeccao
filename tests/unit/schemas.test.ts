import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { candidateSchema, checkSchema, finishRunSchema } from "@/lib/hermes/schemas";

const example = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../hermes/skills/mktech-prospeccao/references/candidato-exemplo.json"), "utf8"),
);

describe("contrato da API do Hermes", () => {
  it("o exemplo da skill é aceito", () => {
    expect(candidateSchema.safeParse(example).success).toBe(true);
  });

  it.each(["stage", "contacted", "contact_events", "proposal_value", "closed_value", "notes", "lead_id"])(
    "recusa o campo comercial %s",
    (field) => {
      expect(candidateSchema.safeParse({ ...example, [field]: "x" }).success).toBe(false);
    },
  );

  it("exige evidência e motivo da seleção", () => {
    expect(candidateSchema.safeParse({ ...example, evidences: [] }).success).toBe(false);
    const { selection_reason: _, ...semMotivo } = example;
    expect(candidateSchema.safeParse(semMotivo).success).toBe(false);
  });

  it("consulta de duplicados não aceita evidências nem notas", () => {
    expect(checkSchema.safeParse({ business_name: "A", city: "Bauru", evidences: [] }).success).toBe(false);
  });

  it("encerramento exige motivo", () => {
    const base = { status: "falhou", searched: 0, approved: 0, discarded: 0, errors: 1 };
    expect(finishRunSchema.safeParse(base).success).toBe(false);
    expect(finishRunSchema.safeParse({ ...base, end_reason: "sem provedor de busca" }).success).toBe(true);
  });
});

describe("diagnóstico no contrato", () => {
  it("o exemplo da skill traz um diagnóstico válido", () => {
    expect(example.diagnosis).toBeDefined();
    expect(candidateSchema.safeParse(example).success).toBe(true);
  });

  it("recusa oferta desconhecida, nota fora de 0-100 e dor sem evidência", () => {
    const d = example.diagnosis;
    expect(candidateSchema.safeParse({ ...example, diagnosis: { ...d, offer: "trafego_pago" } }).success).toBe(false);
    expect(candidateSchema.safeParse({ ...example, diagnosis: { ...d, fit_score: 120 } }).success).toBe(false);
    expect(candidateSchema.safeParse({ ...example, diagnosis: { ...d, pains: [{ pain: "x" }] } }).success).toBe(false);
  });

  it("diagnóstico não aceita campos de mensagem ou contato", () => {
    const d = example.diagnosis;
    expect(candidateSchema.safeParse({ ...example, diagnosis: { ...d, message_to_send: "Oi!" } }).success).toBe(false);
  });
});
