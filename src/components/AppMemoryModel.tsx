"use client";

import { useEffect, useId, useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ProxyTarget } from "@/lib/config";
import type { App, AppLauncherSettings, ComponentStatus, ModelList } from "@/lib/types";

export function AppMemoryModel({
  target,
  appId,
  settings,
  status,
  onSaved,
}: {
  target: ProxyTarget;
  appId: string;
  settings: AppLauncherSettings;
  status: ComponentStatus;
  onSaved: (value: AppLauncherSettings, status: ComponentStatus) => void;
}) {
  const uid = useId();
  const [models, setModels] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [effective, setEffective] = useState<AppLauncherSettings | null>(settings);
  const [observedStatus, setObservedStatus] = useState<ComponentStatus | null>(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  useEffect(() => {
    setEffective(settings);
    setObservedStatus(status);
  }, [settings, status]);
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
      await api.patch<AppLauncherSettings>(target, `/v1/apps/${appId}/settings`, {
        memoryModel: model,
      });
      setDraft("");
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      try {
        const app = await api.get<App>(target, `/v1/apps/${appId}`);
        if (!app.settings) throw new Error("The saved model could not be read.");
        setEffective(app.settings);
        setObservedStatus(app.status);
        onSaved(app.settings, app.status);
      } catch (readFailure) {
        setEffective(null);
        setObservedStatus(null);
        setError((previous) => [previous, describeError(readFailure)].filter(Boolean).join(" "));
      }
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
            ? observedStatus === "running"
              ? `Model in effect: ${effective.memoryModel}`
              : observedStatus === "starting"
                ? `Saved: ${effective.memoryModel}. Starting.`
                : `Saved: ${effective.memoryModel}. Not running.`
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
