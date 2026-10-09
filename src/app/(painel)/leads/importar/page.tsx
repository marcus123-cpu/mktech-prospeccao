import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { Importer } from "./Importer";

export const metadata = { title: "Importar planilha" };

export default async function ImportPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Importar planilha"
        subtitle="Leia o arquivo, confira o mapeamento, valide e só então confirme. A planilha original não é alterada."
      />
      <Importer />
    </>
  );
}
