import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { QueryProvider } from "@/components/QueryProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </QueryProvider>
  );
}
