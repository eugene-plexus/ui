"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { agentTarget, workbenchLink } from "@/lib/apps";
import type { RunTask } from "@/lib/oneClickRun";
import { kindOfFile } from "@/lib/searchModels";
import { formatSelection } from "@/lib/resourceTree";
import type { AppList, NodeIdentity, Runtime } from "@/lib/types";

/** A successful launch offers a usable destination, using the served model ID
 * reported by the agent (the Library's file ID is not a gateway model name). */
export function RunReadyActions({ task }: { task: RunTask }) {
  const [href, setHref] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [checked, setChecked] = useState(false);
  const fileKind = kindOfFile(task.model.capabilities);
  const kind =
    runtime?.mode === "reranking" || runtime?.capabilities?.reranking
      ? "sorter"
      : runtime?.mode === "embedding" || runtime?.capabilities?.embeddings
        ? "search"
        : runtime?.mode === "chat"
          ? "chat"
          : fileKind;
  useEffect(() => {
    let alive = true;
    setHref(null);
    setRuntime(null);
    setChecked(false);
    void (async () => {
      const [local, roster, running] = await Promise.all([
        api.get<NodeIdentity>("agent", "/v1/node").catch(() => null),
        api.get<{ nodes?: { name: string }[] }>("control", "/v1/nodes").catch(() => null),
        task.runtime
          ? api
              .get<Runtime>(task.node.target, `/v1/runtimes/${encodeURIComponent(task.runtime)}`)
              .catch(() => null)
          : null,
      ]);
      const names = [
        ...new Set([local?.name ?? null, ...(roster?.nodes ?? []).map((n) => n.name)]),
      ];
      const apps = await Promise.all(
        names.map((name) =>
          api
            .get<AppList>(agentTarget(name, local?.name ?? null), "/v1/apps")
            .then((list) => list.apps ?? [])
            .catch(() => []),
        ),
      );
      const link = workbenchLink(apps.flat(), window.location.hostname);
      if (!alive) return;
      setRuntime(running);
      setChecked(true);
      const runningKind =
        running?.mode === "reranking" || running?.capabilities?.reranking
          ? "sorter"
          : running?.mode === "embedding" || running?.capabilities?.embeddings
            ? "search"
            : running?.mode === "chat"
              ? "chat"
              : fileKind;
      if (link && running?.status === "ready" && (runningKind !== "chat" || running.modelAlias)) {
        const url = new URL(link.href);
        if (runningKind === "chat") url.searchParams.set("model", running.modelAlias!);
        else url.pathname = "/documents";
        setHref(url.toString());
      }
    })();
    return () => {
      alive = false;
    };
  }, [task.node.target, task.runtime, fileKind]);
  const backend = `/inference?${new URLSearchParams({
    sel: formatSelection(
      runtime?.driver
        ? { type: "driver", node: task.node.name, name: runtime.driver }
        : { type: "backendsNode", node: task.node.name, name: null },
    ),
  })}`;
  return (
    <div className="mt-2 space-y-2" data-testid="run-ready-actions">
      <p>
        {!runtime
          ? checked
            ? `Current status on ${task.node.label} is unavailable. Open model details to check it.`
            : "Checking current model availability."
          : runtime.status !== "ready"
            ? `Model status on ${task.node.label}: ${runtime.status}.`
            : kind === "search"
              ? `Available for document search on ${task.node.label}. Workbench can use it with Automatic search.`
              : kind === "sorter"
                ? `Available for sorting search results on ${task.node.label}. Workbench can use it with Automatic sorting.`
                : `Started on ${task.node.label}.`}
      </p>
      <div className="flex flex-wrap gap-3">
        {href && (
          <a
            href={href}
            className="action-button action-button--primary rounded-[var(--radius)] bg-[color:var(--accent-left)] px-3 py-1.5 font-semibold text-[color:var(--on-accent-left)]"
            data-testid="run-workbench"
          >
            {kind === "chat" ? "Open in Workbench" : "Open Documents in Workbench"}
          </a>
        )}
        {!href && kind === "chat" && (
          <Link href="/" className="underline" data-testid="run-try-it">
            Try it on Home
          </Link>
        )}
        <Link href={backend} className="self-center underline">
          View model and hardware details
        </Link>
      </div>
    </div>
  );
}
