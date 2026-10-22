"use client";

import { AppShell } from "@/components/AppShell";
import { ModelRoles } from "@/components/ModelRoles";

export default function ModelRolesPage() {
  return (
    <AppShell>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <ModelRoles />
        </div>
      </main>
    </AppShell>
  );
}
