import type { LibraryModel, Runtime, RuntimeStatus, StopReason } from "@/lib/types";

/**
 * Is this model already running on the machine the page is about?
 *
 * Reported from the live install on 2026-09-17: the Library's model
 * detail showed **"Needs partial CPU offload"**, **"Will not fit on
 * Amish_Station"** and a full-size **Run** button — for the model that
 * was running on Amish_Station at the time, and serving.
 *
 * Both halves came from the same blind spot. The page joins the library
 * (what is on disk) with the picked node's engines (what could load it)
 * and never asked that node what it is *doing*, so:
 *
 *  - **the verdict was self-defeating.** A fit is scored against *free*
 *    VRAM, and this model's own weights are inside the part that is not
 *    free — because it is loaded. The one model the machine had proved
 *    it could run was the one the page said it could not. The arithmetic
 *    is right and the question was wrong: with a copy resident, "will it
 *    fit" is a question about a **second** copy.
 *  - **Run was the primary action for something already running.** Troy:
 *    *"I know it may be technically possible to run two models on a
 *    single GPU, but I expect that is the exception, not the norm."* So
 *    a second copy is an expert's deliberate act, not the button a page
 *    leads with.
 *
 * The join lives here and not in the library, because the library reads
 * disks and has no idea what any node has loaded — the same division the
 * Inference screen is built on.
 */

/** What the picked node is doing with this model, if anything. */
export interface RunningModel {
  /** The runtime's name on that node, for `/v1/runtimes/{name}/…`. */
  runtime: string;
  status: RuntimeStatus;
  /** Serving requests right now. */
  live: boolean;
  /** On its way up — starting, loading, or copying the file here. */
  busy: boolean;
  /** Declared against this model but not running. */
  stopped: boolean;
  /** Why, when the node said. Three values, not free text. */
  stopReason: StopReason | null;
  /** The companion driver, when the agent declared one. */
  driver: string | null;
  /** What the engine is actually opening — a mapped path, or a local copy. */
  localPath: string | null;
}

/** Up and serving. */
const LIVE: readonly RuntimeStatus[] = ["ready"];
/** On the way up. `copying` is the node-local copy, which can be minutes. */
const BUSY: readonly RuntimeStatus[] = ["copying", "starting", "loading"];

/**
 * The runtimes on one node that are this model, most interesting first.
 *
 * **Joined on `modelPath`, never `localPath`.** M11 made `modelPath` the
 * declaration — the library's own spelling, untouched — precisely so it
 * stays a stable identifier while `localPath` moves with this node's
 * mounts, its overrides and, since 2026-09-17, its local copy. Matching
 * on the resolved path would lose the model the moment a node started
 * opening its own copy of it, which is the exact case that makes this
 * page's advice matter.
 */
export function runtimesForModel(model: LibraryModel, runtimes: Runtime[]): Runtime[] {
  const matched = runtimes.filter((r) => samePath(r.modelPath, model.path));
  // `ready` before anything on its way up, before anything stopped: the
  // page states the strongest true thing about this model.
  const rank = (r: Runtime) => (LIVE.includes(r.status) ? 0 : BUSY.includes(r.status) ? 1 : 2);
  return [...matched].sort((a, b) => rank(a) - rank(b));
}

/** The one to talk about, or null when the node is not running this model. */
export function runningModel(model: LibraryModel, runtimes: Runtime[]): RunningModel | null {
  const best = runtimesForModel(model, runtimes)[0];
  if (!best) return null;
  return {
    runtime: best.name,
    status: best.status,
    live: LIVE.includes(best.status),
    busy: BUSY.includes(best.status),
    stopped: !LIVE.includes(best.status) && !BUSY.includes(best.status),
    stopReason: best.stopReason ?? null,
    driver: best.driver ?? null,
    localPath: best.localPath ?? null,
  };
}

/**
 * Do two declared paths name the same file?
 *
 * Exact first, which is the answer on every install where the UI
 * launched the runtime — it passes the library's own string through.
 *
 * The fallback follows `library-folders-and-reach`'s standing rule:
 * **the path's own shape says which OS it is spelled for.** A drive
 * letter or a UNC prefix is Windows, where `\` and `/` are the same
 * separator and case is not significant, so an operator who declared a
 * runtime by hand with `C:/models/x.gguf` still matches the library's
 * `C:\Models\x.gguf`. A POSIX path gets no such licence: two POSIX paths
 * differing only in case are two different files, and folding them would
 * report a model as running when something else is.
 */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (!looksWindows(a) || !looksWindows(b)) return false;
  return windowsKey(a) === windowsKey(b);
}

function looksWindows(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
}

function windowsKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * One sentence for the state, in the page's own voice.
 *
 * `where` is the machine's label as the picker spells it, so a
 * single-box install reads "this machine" rather than a hostname the
 * operator never chose.
 */
export function describeRunning(running: RunningModel, where: string): string {
  if (running.live) return `Running on ${where} now.`;
  if (running.status === "copying") return `Copying onto ${where} before it starts.`;
  if (running.status === "loading") return `Loading into memory on ${where}.`;
  if (running.status === "starting") return `Starting on ${where}.`;
  const why = STOP_REASON[running.stopReason ?? "operator"];
  return running.stopReason
    ? `Set up on ${where}, not running: ${why}.`
    : `Set up on ${where} and not running.`;
}

/**
 * `StopReason` in the page's words.
 *
 * Three values and not free text, so this is a translation rather than a
 * fallback — and each one wants a different next move, which is why the
 * raw token would not do: an idle unload is the system working, and an
 * operator stop is a decision to undo.
 */
const STOP_REASON: Record<StopReason, string> = {
  operator: "someone stopped it",
  idle: "nothing asked for it, so the gateway unloaded it",
  autoStart: "it is set not to start on its own",
};
