import { describe, expect, it } from "vitest";
import { receiptLabel } from "@/lib/message-receipts";
describe("confirmações do WhatsApp", () => {
  it("não presume leitura sem confirmação", () => {
    expect(receiptLabel(null)).toBe("Sem confirmação");
    expect(receiptLabel(undefined)).toBe("Sem confirmação");
    expect(receiptLabel(1)).toBe("Enviada");
    expect(receiptLabel(2)).toBe("Entregue");
    expect(receiptLabel(3)).toBe("Visualizada");
    expect(receiptLabel(4)).toBe("Reproduzida");
    expect(receiptLabel(-1)).toBe("Falha no envio");
  });
});
