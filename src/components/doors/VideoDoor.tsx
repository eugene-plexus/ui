"use client";

/**
 * The video door: a job made, watched and downloaded (`/v1/videos`, P5).
 * A video bills the provider account behind the model, often more than a
 * picture, so Send asks once (Troy, 2026-09-28). The job keeps running
 * at the provider whether or not this page watches it.
 */

import { useEffect, useRef, useState } from "react";

import { ConfirmButton } from "@/components/ConfirmButton";
import type { Transport } from "@/lib/completions";
import {
  type DoorReport as Report,
  newDoorReport,
  recordDoorFailure,
  sendToDoor,
} from "@/lib/doorRequest";
import type { Model } from "@/lib/types";
import {
  EMPTY_VIDEO_DRAFT,
  POLL_MS,
  type VideoDraft,
  type VideoJob,
  buildVideoRequest,
  describeJob,
  durationsFor,
  isFinished,
  jobPath,
  mediaUrl,
  sizesFor,
  takesFirstFrame,
} from "@/lib/videoDoor";

import { DoorModelSelect, keepModel } from "./DoorModelSelect";
import { DoorReport } from "./DoorReport";
import {
  buttonClass,
  errorClass,
  fieldLabel,
  inputClass,
  primaryButtonClass,
  readDraft,
  textareaClass,
  writeDraft,
} from "./doorStyles";

const DRAFT_KEY = "eugene-playground-door-video";

export function VideoDoor({
  models,
  transport,
  reproduceBaseUrl,
  apiKey,
}: {
  models: readonly Model[];
  transport: Transport;
  reproduceBaseUrl: string | null;
  apiKey: string | null;
}) {
  const [model, setModel] = useState(models[0]?.id ?? "");
  // Read when the state is made: an effect would run after the first
  // paint and overwrite whatever was chosen before it did.
  const [draft, setDraft] = useState<VideoDraft>(() => readDraft(DRAFT_KEY, EMPTY_VIDEO_DRAFT));
  const [firstFrame, setFirstFrame] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [watching, setWatching] = useState(false);
  const [video, setVideo] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<() => void>(() => {});

  useEffect(() => {
    writeDraft(DRAFT_KEY, draft);
  }, [draft]);
  useEffect(() => {
    setModel((current) => keepModel(models, current));
  }, [models]);
  useEffect(() => () => revokeRef.current(), []);

  const selected = models.find((m) => m.id === model);
  const durations = durationsFor(selected);
  const sizes = sizesFor(selected);
  const firstFrameOffered = takesFirstFrame(selected);
  const built = buildVideoRequest(model, draft, firstFrameOffered ? firstFrame : null);

  // Watch a job until it finishes, then fetch the file. Each poll is its
  // own request; only the one that made the job is reported.
  useEffect(() => {
    if (!job || !watching || isFinished(job)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const path = jobPath(job.id);
        const probe = newDoorReport(transport, path, { kind: "get" }, reproduceBaseUrl);
        try {
          const response = await sendToDoor(transport, path, { kind: "get" }, probe, {
            accept: "application/json",
            signal: controller.signal,
          });
          setJob((await response.json()) as VideoJob);
        } catch (e) {
          if (controller.signal.aborted) return;
          recordDoorFailure(probe, e);
          setError(`Could not ask about the job: ${probe.error}`);
          setWatching(false);
        }
      })();
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job, watching, transport, reproduceBaseUrl]);

  useEffect(() => {
    if (!job || job.status !== "completed" || video) return;
    const controller = new AbortController();
    void (async () => {
      const path = jobPath(job.id, true);
      const probe = newDoorReport(transport, path, { kind: "get" }, reproduceBaseUrl);
      try {
        const response = await sendToDoor(transport, path, { kind: "get" }, probe, {
          accept: "video/mp4",
          signal: controller.signal,
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        revokeRef.current();
        const made = mediaUrl(bytes, response.headers.get("content-type") ?? "video/mp4");
        revokeRef.current = made.revoke;
        setVideo(made.url);
        setWatching(false);
      } catch (e) {
        if (controller.signal.aborted) return;
        recordDoorFailure(probe, e);
        setError(`The video is finished but could not be fetched: ${probe.error}`);
      }
    })();
    return () => controller.abort();
  }, [job, video, transport, reproduceBaseUrl]);

  async function send() {
    if ("error" in built) return;
    const request = built.request;
    const payload =
      request.kind === "form"
        ? { kind: "form" as const, form: request.form, fields: request.fields }
        : { kind: "json" as const, body: request.body };
    const next = newDoorReport(transport, "/v1/videos", payload, reproduceBaseUrl);
    setPending(true);
    setError(null);
    setJob(null);
    setVideo(null);
    const started = performance.now();
    try {
      const response = await sendToDoor(transport, "/v1/videos", payload, next, {
        accept: "application/json",
      });
      const made = (await response.json()) as VideoJob;
      next.firstByteMs = Math.round(performance.now() - started);
      next.routing = made.x_eugene_plexus ?? next.routing;
      setJob(made);
      setWatching(true);
    } catch (e) {
      recordDoorFailure(next, e);
      setError(next.error);
    } finally {
      next.elapsedMs = Math.round(performance.now() - started);
      setReport(next);
      setPending(false);
    }
  }

  return (
    <div data-testid="video-door" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DoorModelSelect models={models} value={model} onChange={setModel} disabled={pending} />
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Length</span>
            {durations ? (
              <select
                data-testid="video-seconds"
                value={draft.seconds}
                onChange={(e) => setDraft({ ...draft, seconds: e.target.value })}
                className={inputClass}
              >
                <option value="">default</option>
                {durations.map((d) => (
                  <option key={d} value={String(d)}>
                    {d} s
                  </option>
                ))}
              </select>
            ) : (
              <input
                data-testid="video-seconds"
                value={draft.seconds}
                onChange={(e) => setDraft({ ...draft, seconds: e.target.value })}
                placeholder="seconds"
                inputMode="numeric"
                className={`${inputClass} w-24`}
              />
            )}
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Size</span>
            {sizes ? (
              <select
                data-testid="video-size"
                value={draft.size}
                onChange={(e) => setDraft({ ...draft, size: e.target.value })}
                className={inputClass}
              >
                <option value="">default</option>
                {sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : (
              <input
                data-testid="video-size"
                value={draft.size}
                onChange={(e) => setDraft({ ...draft, size: e.target.value })}
                placeholder="1280x720"
                className={`${inputClass} w-28`}
              />
            )}
          </label>
        </div>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">What happens in it</span>
          <textarea
            data-testid="video-prompt"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            rows={3}
            className={textareaClass}
          />
        </label>
        {firstFrameOffered && (
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Start from this picture (optional)</span>
            <input
              data-testid="video-first-frame"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setFirstFrame(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </label>
        )}
        {"error" in built && <p className={errorClass}>{built.error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            label="Make it"
            confirmLabel="Send, and pay for it"
            cancelLabel="Not now"
            prompt="A video bills the account behind this model, often more than a picture."
            onConfirm={send}
            disabled={pending || !model || "error" in built || (watching && !!job)}
            className={primaryButtonClass}
            testId="video-send"
          />
          {job && !isFinished(job) && (
            <button
              type="button"
              data-testid="video-watch"
              onClick={() => setWatching((w) => !w)}
              className={buttonClass}
            >
              {watching ? "Stop watching" : "Keep watching"}
            </button>
          )}
        </div>
        {job && (
          <div className="flex flex-col gap-1 text-sm">
            <p data-testid="video-status">{describeJob(job)}</p>
            {job.status === "in_progress" && typeof job.progress === "number" && (
              <progress max={100} value={job.progress} className="w-64" />
            )}
            {!watching && !isFinished(job) && (
              <p className="text-[color:var(--muted)]">
                The job keeps running at the provider. Keep watching to fetch it when it is done.
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" data-testid="video-error" className={errorClass}>
            {error}
          </p>
        )}
        {video && (
          <div className="flex flex-col gap-2">
            <video
              data-testid="video-result"
              controls
              src={video}
              className="max-h-96 max-w-full"
            />
            <a
              data-testid="video-download"
              href={video}
              download="video.mp4"
              className={`${buttonClass} self-start`}
            >
              Save video.mp4
            </a>
          </div>
        )}
      </div>
      {report && <DoorReport report={report} apiKey={apiKey} />}
    </div>
  );
}
