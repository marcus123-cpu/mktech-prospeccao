import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { NewLeadForm } from "./NewLeadForm";

export const metadata = { title: "Novo lead" };

export default async function NewLeadPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader
        title="Novo lead"
        subtitle="O sistema verifica duplicados antes de salvar. Se houver dúvida, o cadastro vai para a fila de revisão."
      />
      <NewLeadForm />
    </>
  );
}
