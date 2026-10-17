export function receiptLabel(ack: number | null | undefined) {
  if (ack === 4) return "Reproduzida";
  if (ack === 3) return "Visualizada";
  if (ack === 2) return "Entregue";
  if (ack === 1) return "Enviada";
  if (ack === 0) return "Aguardando envio";
  if (ack === -1) return "Falha no envio";
  return "Sem confirmação";
}
