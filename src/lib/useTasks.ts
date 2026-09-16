"use client";

import { useCallback, useMemo, useState } from "react";

import { api } from "./api";
import { runTask, useRuns } from "./oneClickRun";
import { hasSessionToken } from "./session";
import { mergeTasks, tasksFrom, type Task, type TaskSources } from "./tasks";
import type {
  DownloadList,
  EngineInstall,
  EngineList,
  RuntimeList,
  RuntimePlacementList,
  Scan,
} from "./types";
import { usePolling } from "./usePolling";

const POLL_MS = 5000;

/**
 * The background tasks, polled for the header tray.
 *
 * Every read is soft. The tray is mounted on every signed-in screen,
 * including the ones a person opens because something is down, and a
 * tray that failed because the library was unreachable would be a second
 * symptom of one fault. A source that did not answer contributes no
 * tasks; it does not blank the others.
 *
 * **Engine installs are asked for per engine.** The agent keeps one
 * install record per engine and answers `GET /v1/engines/{engine}/install`
 * with the current or most recent one, 404 when there has never been
 * one — so an install started from Inference, or from another browser,
 * is discoverable without having started it here. Engines this host
 * cannot install (`acquisition.installable: false`, which is vLLM's
 * `manual` policy everywhere and llama.cpp on Linux+NVIDIA) are not
 * asked, since nothing could be in flight. This machine's only: see the
 * note in `tasks.ts`.
 *
 * Only while signed in: with no session every call would 401 and the
 * api client would bounce the page to `/login` in the middle of, say,
 * the login page.
 */
export function useTasks(): { tasks: Task[]; loaded: boolean; reload: () => Promise<void> } {
  const [polled, setPolled] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The browser's own runs (one-click run, S3) are not polled: the store
  // pushes them, and they sit first because they are the person's action.
  const runs = useRuns();

  const load = useCallback(async () => {
    if (!hasSessionToken()) return;
    const [downloads, scan, runtimes, engines] = await Promise.all([
      api.get<DownloadList>("library", "/v1/downloads").catch(() => null),
      api.get<Scan>("library", "/v1/scan").catch(() => null),
      api.get<RuntimePlacementList>("control", "/v1/runtimes").catch(() => null),
      api.get<EngineList>("agent", "/v1/engines").catch(() => null),
    ]);
    // Without a control root the local agent is the only place runtimes
    // can be read from, and it is read — the Inference screen's rule.
    const localRuntimes =
      runtimes === null
        ? await api.get<RuntimeList>("agent", "/v1/runtimes").catch(() => null)
        : null;
    const installs =
      engines === null
        ? null
        : (
            await Promise.all(
              (engines.engines ?? [])
                .filter((e) => e.acquisition?.installable !== false)
                .map((e) =>
                  api
                    .get<EngineInstall>(
                      "agent",
                      `/v1/engines/${encodeURIComponent(e.engine)}/install`,
                    )
                    .catch(() => null),
                ),
            )
          ).filter((i): i is EngineInstall => i !== null);
    const sources: TaskSources = { downloads, scan, runtimes, localRuntimes, installs };
    setPolled(tasksFrom(sources));
    setLoaded(true);
  }, []);

  usePolling(load, POLL_MS);

  const tasks = useMemo(() => mergeTasks(polled, runs.map(runTask)), [polled, runs]);
  // `reload` so a card that just started a download can pull the tray
  // forward instead of waiting out the poll.
  return { tasks, loaded, reload: load };
}
