import type { SectionHandle } from "@/components/ConfigEditor";

/**
 * Save every dirty section, then restart each process once (CX7).
 *
 * Until 2026-10-20 each section restarted its process as soon as it was
 * saved, so a second section of the gateway PATCHed a process on its way
 * out. Now a section that needs a restart only says so; after the last
 * section of a process is saved, the last one that needed it restarts the
 * process, and the others read their values again. A section that fails
 * keeps its draft and its error, and does not stop the others: what was
 * saved still gets its restart, so nothing reads "pending" for ever.
 */
export async function saveSections(sections: readonly SectionHandle[]): Promise<void> {
  const byProcess = new Map<string, SectionHandle[]>();
  for (const h of sections) {
    const key = h.process ?? `section:${byProcess.size}`;
    byProcess.set(key, [...(byProcess.get(key) ?? []), h]);
  }
  for (const group of byProcess.values()) {
    let restarter: SectionHandle | null = null;
    for (const h of group) {
      const outcome = await h.save({ deferRestart: true });
      if (outcome.restartNeeded) restarter = h;
    }
    if (!restarter?.restart) continue;
    const back = await restarter.restart();
    if (!back) continue;
    for (const h of group) if (h !== restarter) await h.reload?.();
  }
}
