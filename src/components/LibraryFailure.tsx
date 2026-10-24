"use client";

import { useState } from "react";

import { describeError, libraryOutage, type DisplayFailure } from "@/lib/api";

export function LibraryFailure({ error }: { error: DisplayFailure }) {
  const [open, setOpen] = useState(false);
  const outage = libraryOutage(error);
  if (!outage) return describeError(error);
  return (
    <span>
      <span>{describeError(error)}</span>
      {outage && (
        <>
          {" "}
          <button
            type="button"
            className="underline"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            Details
          </button>
          {open && <span className="block text-sm break-words">{outage.cause}</span>}
        </>
      )}
    </span>
  );
}

export interface LibraryState {
  reachable: boolean | null;
  since: string | null;
  cause: string | null;
  modelsOnSavedSettings: number;
}

export function GatewayLibraryState({ library }: { library: LibraryState }) {
  if (library.reachable !== false) return null;
  const n = library.modelsOnSavedSettings;
  return (
    <span title={library.cause ?? undefined}>
      The Library is not answering. {n} {n === 1 ? "model uses its" : "models use their"} last known
      settings.
    </span>
  );
}
