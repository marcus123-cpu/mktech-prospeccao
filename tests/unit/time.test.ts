import { describe, expect, it } from "vitest";
import { fmtPercent, isoToSpLocal, periodRange, spLocalToIso, todaySP } from "@/lib/time";

describe("datas no fuso de São Paulo", () => {
  it("hoje em SP difere do UTC perto da meia-noite", () => {
    expect(todaySP(new Date("2026-10-10T02:30:00Z"))).toBe("2026-10-09");
    expect(todaySP(new Date("2026-10-10T03:30:00Z"))).toBe("2026-10-10");
  });

  it("semana começa na segunda e mês no dia 1", () => {
    const now = new Date("2026-10-09T15:00:00Z"); // sexta
    expect(periodRange("semana", now)).toEqual({ start: "2026-10-05", end: "2026-10-09" });
    expect(periodRange("mes", now)).toEqual({ start: "2026-10-01", end: "2026-10-09" });
    expect(periodRange("personalizado", now, { start: "2026-10-09", end: "2026-09-01" })).toEqual({ start: "2026-09-01", end: "2026-10-09" });
    expect(periodRange("personalizado", now, { start: "lixo", end: "2026-09-01" })).toEqual({ start: "2026-10-09", end: "2026-10-09" });
  });

  it("converte horário digitado em SP para UTC e volta", () => {
    expect(spLocalToIso("2026-10-09T21:30")).toBe("2026-10-10T00:30:00.000Z");
    expect(isoToSpLocal("2026-10-10T00:30:00.000Z")).toBe("2026-10-09T21:30");
    expect(() => spLocalToIso("09/10/2026")).toThrow();
  });

  it("taxa sem denominador aparece como —", () => {
    expect(fmtPercent(null)).toBe("—");
    expect(fmtPercent(0.25)).toBe("25%");
  });
});

import { haQuanto } from "@/lib/time";
describe("haQuanto", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("formata minutos, horas e dias", () => {
    expect(haQuanto("2026-10-10T11:59:50Z", now)).toBe("agora");
    expect(haQuanto("2026-10-10T11:55:00Z", now)).toBe("há 5 min");
    expect(haQuanto("2026-10-10T09:00:00Z", now)).toBe("há 3 h");
    expect(haQuanto("2026-10-08T12:00:00Z", now)).toBe("há 2 dias");
    expect(haQuanto(null, now)).toBe("");
  });
});
