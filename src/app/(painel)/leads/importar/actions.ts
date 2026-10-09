"use server";

import ExcelJS from "exceljs";
import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { dbErrorMessage, requireAdmin } from "@/lib/auth";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

export type ParseResult = { error?: string; headers?: string[]; rows?: string[][]; fileName?: string };

function cellText(cell: ExcelJS.Cell): string {
  // .text devolve o valor como exibido: telefones numéricos não viram notação científica.
  const v = cell.value as unknown;
  if (v && typeof v === "object" && "hyperlink" in (v as object)) {
    const link = v as { text?: string; hyperlink?: string };
    return String(link.hyperlink ?? link.text ?? "");
  }
  return cell.text ?? "";
}

/** Lê CSV ou XLSX e devolve cabeçalhos + linhas como texto. Nada é gravado. */
export async function parseSpreadsheet(_: ParseResult, form: FormData): Promise<ParseResult> {
  await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Escolha um arquivo CSV ou XLSX." };
  if (file.size > MAX_BYTES) return { error: "Arquivo maior que 5 MB." };
  const name = file.name.toLowerCase();
  let table: string[][] = [];
  try {
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
      table = parsed.data.map((r) => r.map((c) => String(c ?? "")));
    } else if (name.endsWith(".xlsx")) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) return { error: "A planilha está vazia." };
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        for (let i = 1; i <= ws.columnCount; i++) cells.push(cellText(row.getCell(i)).trim());
        table.push(cells);
      });
    } else {
      return { error: "Formato não suportado. Use .csv ou .xlsx (no Google Sheets: Arquivo > Fazer download)." };
    }
  } catch {
    return { error: "Não foi possível ler o arquivo." };
  }
  if (table.length < 2) return { error: "A planilha precisa de cabeçalho e pelo menos uma linha." };
  if (table.length - 1 > MAX_ROWS) return { error: `Máximo de ${MAX_ROWS} linhas por importação.` };
  const [headers, ...rows] = table;
  return { headers: headers.map((h, i) => h || `Coluna ${i + 1}`), rows, fileName: file.name };
}

export type ImportResult = {
  error?: string;
  dryRun?: boolean;
  counts?: Record<string, number>;
  rows?: { row: number; status: string; errors?: string[]; reason?: string; lead_id?: string }[];
};

export async function runImport(rowsJson: string, dryRun: boolean): Promise<ImportResult> {
  const { supabase } = await requireAdmin();
  let rows: unknown;
  try {
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "Dados inválidos." };
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) return { error: "Nenhuma linha para importar." };
  const { data, error } = await supabase.rpc("admin_import_rows", { p_rows: rows, p_dry_run: dryRun });
  if (error) return { error: dbErrorMessage(error) };
  if (!dryRun) revalidatePath("/", "layout");
  return { dryRun, counts: data.counts, rows: data.rows };
}
