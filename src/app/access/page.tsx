"use client";

import { AppShell } from "@/components/AppShell";
import { AccessSetup } from "@/components/AccessSetup";

export default function AccessPage() {
  return (
    <AppShell>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AccessSetup />
      </div>
    </AppShell>
  );
}
