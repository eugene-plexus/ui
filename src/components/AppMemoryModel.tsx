"use client";

import { useEffect, useId, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ProxyTarget } from "@/lib/config";
import type { AppLauncherSettings, ModelList } from "@/lib/types";

export function AppMemoryModel({
  target,
  appId,
  settings,
  onSaved,
}: {
  target: ProxyTarget;
  appId: string;
  settings: AppLauncherSettings;
  onSaved: (value: AppLauncherSettings) => void;
}) {
  const uid = useId();
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [effective, setEffective] = useState<AppLauncherSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  useEffect(() => {
    setEffective(settings);
  }, [settings]);
  useEffect(() => {
    let active = true;
    api
      .get<ModelList>("gateway", "/v1/models")
      .then((listing) => {
        if (!active) return;
        setModels(
          listing.data
            .filter((m) => m.x_eugene_plexus?.surfaces?.includes("chat"))
            .map((m) => m.id),
        );
      })
      .catch((failure) => {
        if (active) setListingError(describeError(failure));
      });
    return () => {
      active = false;
    };
  }, []);

  async function apply(model: string | null) {
    setBusy(true);
    setError(null);
    try {
      const value = await api.patch<AppLauncherSettings>(target, `/v1/apps/${appId}/settings`, {
        memoryModel: model,
      });
      setEffective(value);
      onSaved(value);
      setDraft("");
    } catch (failure) {
      setError(describeError(failure));
      try {
        const value = await api.get<AppLauncherSettings>(target, `/v1/apps/${appId}/settings`);
        setEffective(value);
        onSaved(value);
      } catch (readFailure) {
        setEffective(null);
        setError(`${describeError(failure)} ${describeError(readFailure)}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${uid}-title`} className="flex flex-col gap-2">
      <h3 id={`${uid}-title`} className="font-ui font-semibold">
        Model
      </h3>
      <p data-testid="memory-model-effective">
        {effective === null
          ? "The model in effect could not be read."
          : effective.memoryModel
            ? `Model in effect: ${effective.memoryModel}`
            : "Choose the model Hindsight reads your chats with"}
      </p>
      <p className="text-sm text-[color:var(--muted)]">
        The probe measured Gemma 4 12B and Qwen3.8-27B. These results are advice. You can use an
        untested model.
      </p>
      {listingError && <p role="alert">Models could not be listed: {listingError}</p>}
      {error && <p role="alert">{error}</p>}
      <label htmlFor={`${uid}-choice`}>New model</label>
      <select
        id={`${uid}-choice`}
        value={models.includes(draft) ? draft : ""}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      >
        <option value="">Choose a model</option>
        {models.map((id) => (
          <option key={id} value={id}>
            {id}
            {/^(gemma-4-12b|qwen3\.8-27b)$/i.test(id) ? " (probe measured)" : ""}
          </option>
        ))}
      </select>
      <label htmlFor={`${uid}-expert`}>Model id (expert)</label>
      <input
        id={`${uid}-expert`}
        value={draft}
        disabled={busy}
        maxLength={512}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="action-button"
          disabled={busy || !draft.trim()}
          onClick={() => void apply(draft.trim())}
        >
          Apply model
        </button>
        <button
          type="button"
          className="action-button"
          disabled={busy || !effective?.memoryModel}
          onClick={() => void apply(null)}
        >
          Clear model and stop
        </button>
      </div>
    </section>
  );
}
