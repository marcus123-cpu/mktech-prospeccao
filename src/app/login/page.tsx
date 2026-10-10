import { AuthCard } from "@/components/AuthCard";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const notice = erro === "sem-permissao" ? "Esta conta não tem acesso ao painel." : erro === "link" ? "Link inválido ou expirado." : undefined;
  return (
    <AuthCard title="Entrar no painel">
      <LoginForm notice={notice} />
    </AuthCard>
  );
}
