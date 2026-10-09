"use client";

/**
 * The images door: make a picture, or edit one (`/v1/images/generations`,
 * `/v1/images/edits`, P4). A picture bills the provider account behind
 * the model, so Send asks once (Troy, 2026-09-28).
 *
 * Editing, streaming and a mask are offered only where the model's
 * listing says it can; the form sends none of them otherwise.
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
import {
  EMPTY_IMAGE_DRAFT,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  type ImageDraft,
  type ImagesAnswer,
  answerFromImages,
  buildEditForm,
  buildGenerateBody,
  readImageStream,
} from "@/lib/imageDoor";
import type { Model } from "@/lib/types";

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

const DRAFT_KEY = "eugene-playground-door-image";

export function ImageDoor({
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
  const [draft, setDraft] = useState<ImageDraft>(() => readDraft(DRAFT_KEY, EMPTY_IMAGE_DRAFT));
  const [images, setImages] = useState<File[]>([]);
  const [mask, setMask] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [partials, setPartials] = useState<string[]>([]);
  const [answer, setAnswer] = useState<ImagesAnswer | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    writeDraft(DRAFT_KEY, draft);
  }, [draft]);
  useEffect(() => {
    setModel((current) => keepModel(models, current));
  }, [models]);

  const flags = models.find((m) => m.id === model)?.x_eugene_plexus;
  const canEdit = flags?.image_edits === true;
  const canStream = flags?.image_streaming === true;
  const canMask = canEdit && flags?.image_mask === true;
  // What is sent: only the choices this model offers.
  const effective: ImageDraft = {
    ...draft,
    mode: draft.mode === "edit" && canEdit ? "edit" : "generate",
    stream: draft.stream && canStream,
  };
  const editing = effective.mode === "edit";
  const path = editing ? "/v1/images/edits" : "/v1/images/generations";
  const built = editing
    ? buildEditForm(model, effective, images, canMask ? mask : null)
    : buildGenerateBody(model, effective);

  async function send() {
    if ("error" in built) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const payload =
      "form" in built
        ? { kind: "form" as const, form: built.form, fields: built.fields }
        : { kind: "json" as const, body: built.body };
    const next = newDoorReport(transport, path, payload, reproduceBaseUrl);
    setPending(true);
    setError(null);
    setAnswer(null);
    setPartials([]);
    const started = performance.now();
    try {
      const response = await sendToDoor(transport, path, payload, next, {
        accept: effective.stream ? "text/event-stream" : "application/json",
        signal: controller.signal,
      });
      let result: ImagesAnswer;
      if (effective.stream) {
        result = await readImageStream(
          response,
          (src, index) =>
            setPartials((current) => {
              const copy = [...current];
              copy[index] = src;
              return copy;
            }),
          () => {
            next.firstByteMs ??= Math.round(performance.now() - started);
          },
        );
      } else {
        const text = await response.text();
        next.firstByteMs = Math.round(performance.now() - started);
        next.bytes = new TextEncoder().encode(text).length;
        result = answerFromImages(JSON.parse(text));
      }
      next.routing = result.routing ?? next.routing;
      setAnswer(result);
      if (result.truncatedBy) setError(`Cut short: ${result.truncatedBy}`);
    } catch (e) {
      if (controller.signal.aborted) {
        setError("Stopped.");
      } else {
        recordDoorFailure(next, e);
        setError(next.error);
      }
    } finally {
      next.elapsedMs = Math.round(performance.now() - started);
      setReport(next);
      setPending(false);
      abortRef.current = null;
    }
  }

  const shown = answer && answer.pictures.length > 0 ? answer.pictures.map((p) => p.src) : partials;
  return (
    <div data-testid="image-door" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 p-4">
        {canEdit && (
          <div role="radiogroup" aria-label="What to do" className="flex gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                data-testid="image-mode-generate"
                checked={!editing}
                onChange={() => setDraft({ ...draft, mode: "generate" })}
              />
              Make a new picture
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                data-testid="image-mode-edit"
                checked={editing}
                onChange={() => setDraft({ ...draft, mode: "edit" })}
              />
              Change a picture
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <DoorModelSelect models={models} value={model} onChange={setModel} disabled={pending} />
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Size</span>
            <input
              data-testid="image-size"
              value={draft.size}
              onChange={(e) => setDraft({ ...draft, size: e.target.value })}
              placeholder="1024x1024"
              className={`${inputClass} w-28`}
            />
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Quality</span>
            <select
              data-testid="image-quality"
              value={draft.quality}
              onChange={(e) => setDraft({ ...draft, quality: e.target.value })}
              className={inputClass}
            >
              <option value="">default</option>
              {IMAGE_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">File type</span>
            <select
              data-testid="image-format"
              value={draft.outputFormat}
              onChange={(e) => setDraft({ ...draft, outputFormat: e.target.value })}
              className={inputClass}
            >
              <option value="">default</option>
              {IMAGE_OUTPUT_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            <span className="text-[color:var(--muted)]">Pictures</span>
            <input
              data-testid="image-n"
              value={draft.n}
              onChange={(e) => setDraft({ ...draft, n: e.target.value })}
              placeholder="1"
              inputMode="numeric"
              className={`${inputClass} w-16`}
            />
          </label>
          {canStream && (
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                data-testid="image-stream"
                checked={draft.stream}
                onChange={(e) => setDraft({ ...draft, stream: e.target.checked })}
              />
              Show it as it is drawn
            </label>
          )}
        </div>
        <label className={fieldLabel}>
          <span className="text-[color:var(--muted)]">
            {editing ? "What to change" : "What to draw"}
          </span>
          <textarea
            data-testid="image-prompt"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
            rows={3}
            className={textareaClass}
          />
        </label>
        {editing && (
          <div className="flex flex-wrap gap-4">
            <label className={fieldLabel}>
              <span className="text-[color:var(--muted)]">Picture or pictures to change</span>
              <input
                data-testid="image-files"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setImages(Array.from(e.target.files ?? []))}
                className="text-sm"
              />
            </label>
            {canMask && (
              <label className={fieldLabel}>
                <span className="text-[color:var(--muted)]">
                  Mask: the clear part is what changes (optional)
                </span>
                <input
                  data-testid="image-mask"
                  type="file"
                  accept="image/png"
                  onChange={(e) => setMask(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
              </label>
            )}
          </div>
        )}
        {"error" in built && <p className={errorClass}>{built.error}</p>}
        <div className="flex items-center gap-2">
          <ConfirmButton
            label={editing ? "Change it" : "Make it"}
            confirmLabel="Send, and pay for it"
            cancelLabel="Not now"
            prompt="A picture bills the account behind this model."
            onConfirm={send}
            disabled={pending || !model || "error" in built}
            className={primaryButtonClass}
            testId="image-send"
          />
          {pending && (
            <button type="button" onClick={() => abortRef.current?.abort()} className={buttonClass}>
              Stop
            </button>
          )}
        </div>
        {error && (
          <p role="alert" data-testid="image-error" className={errorClass}>
            {error}
          </p>
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {shown.map((src, i) => (
              <figure key={i} className="flex flex-col gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  data-testid={answer?.pictures.length ? "image-result" : "image-partial"}
                  src={src}
                  alt={`Picture ${i + 1}`}
                  className="max-h-80 max-w-full rounded-[var(--radius)] border border-[color:var(--border)]"
                />
                {answer?.pictures[i]?.revisedPrompt && (
                  <figcaption className="max-w-xs text-xs text-[color:var(--muted)]">
                    Drawn from: {answer.pictures[i]!.revisedPrompt}
                  </figcaption>
                )}
                {answer?.pictures.length ? (
                  <a
                    data-testid="image-download"
                    href={src}
                    download={`picture-${i + 1}.${src.slice(11, src.indexOf(";")).replace("jpeg", "jpg").replace("svg+xml", "svg")}`}
                    className={`${buttonClass} self-start`}
                  >
                    Save
                  </a>
                ) : null}
              </figure>
            ))}
          </div>
        )}
        {answer?.usage && (
          <p data-testid="image-usage" className="text-sm text-[color:var(--muted)]">
            {answer.usage.total_tokens != null
              ? `${answer.usage.total_tokens} tokens billed.`
              : "The provider reported its use."}
          </p>
        )}
      </div>
      {report && <DoorReport report={report} apiKey={apiKey} />}
    </div>
  );
}
