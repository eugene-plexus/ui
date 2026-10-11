"use client";

import { useEffect, useState } from "react";

import { RunsAs } from "@/components/RunsAs";
import { ApiError, api } from "@/lib/api";
import { isSearchFile, type ModeChoice } from "@/lib/searchModels";
import type { LibraryModel, ModelProfileList } from "@/lib/types";

/**
 * What Run will make of this file, said under the button that runs it (MR3).
 *
 * "Runs as: search model (found in the file)". It is what the model's own
 * profile says when a person chose, and the file's header otherwise: the default
 * profile is the one Run starts, so its `mode` is the one that counts. Said for a
 * search model or a result sorter, and for any file whose profile overrides
 * Auto; a plain chat model with nothing chosen needs no line.
 *
 * Read-only here. The override is a choice among a profile's settings, so it is
 * made in the profile, below, and the link goes there.
 *
 * `version` changes when a profile is saved, so the line is never about a
 * profile that has since been edited.
 */
export function RunsAsNote({ model, version }: { model: LibraryModel; version: number }) {
  const [mode, setMode] = useState<ModeChoice | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.get<ModelProfileList>(
          "library",
          `/v1/models/${encodeURIComponent(model.id)}/profiles`,
        );
        const profiles = list.profiles ?? [];
        // The one Run uses: the default, else the first.
        const used = profiles.find((p) => p.default) ?? profiles[0];
        if (!cancelled) setMode(used?.mode ?? null);
      } catch (err) {
        // Not worth a banner: the line then says what the file says, which is true.
        if (!cancelled && !(err instanceof ApiError && err.status === 401)) setMode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [model.id, version]);

  const chosen = mode !== null && mode !== "auto";
  if (!isSearchFile(model.capabilities) && !chosen) return null;
  return (
    <div data-testid="run-runs-as" className="mt-2">
      <RunsAs capabilities={model.capabilities} mode={mode} />
      <p className="mt-1 text-[0.8125rem]">
        <a href="#launch-profiles" className="underline">
          Change how it runs
        </a>
      </p>
    </div>
  );
}
