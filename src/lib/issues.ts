/**
 * Things that need a person, as one list, from the endpoints that
 * already report them.
 *
 * Principle P7's second half in the hobbyist UX design: *one tray in the
 * header for downloads, installs, loads, restarts; one Issues list for
 * things that need a person*. And P4, *nothing silent*: §3's top three
 * field failures all fail with a green status, and this install has
 * produced two of them itself — a control root that came back sealed
 * while agent, gateway and control all answered `"status":"ok"`, and a
 * worker taken out of the install by half a second of clock drift while
 * every health check passed.
 *
 * **Pure on purpose**, like `tasks.ts`: it takes raw bodies and returns
 * `Issue[]`, so every rule can be tested against the shapes the
 * components really send rather than against fixtures invented to match
 * the code. `useIssues.ts` does the polling.
 *
 * **An issue is not a task.** A task is work in flight that will finish
 * on its own; an issue is a thing that will not get better until
 * somebody does something, so each one carries what to do and where.
 * Nothing goes in this list that resolves itself.
 *
 * **What is NOT here, and why** — these were in S7's brief and came out
 * on measurement:
 *
 *   - *A machine with no accelerator.* Every model on it runs on the
 *     processor, which is true, permanent and needs nobody. It is a
 *     state on the Inference row (`describeCompute`), not an issue.
 *   - *A CPU-only engine build on a machine that has a GPU* — the
 *     commonest complaint in the field research, and not observable:
 *     `EngineDescriptor` carries `version` and `binaryPath` but no
 *     installed variant, the managed store's layout is
 *     `<engine>/<version>/` with the variant only inside `install.json`,
 *     and `GET /v1/engines/{engine}/install` describes the last install
 *     this agent performed rather than the build in use. It wants one
 *     field (`EngineDescriptor.installedVariant`) and is deliberately
 *     not taken here.
 */

import type {
  Component,
  ComponentList,
  ComputeDevice,
  ControlRootView,
  EngineList,
  LibraryFolderReach,
  NodeIdentity,
  Runtime,
  RuntimeList,
} from "./types";
import { nodeLiveness } from "./nodeLiveness";

export type IssueKind =
  | "control-sealed"
  | "component-down"
  | "node-down"
  | "folder-unreachable"
  | "clock-skew"
  | "trust-stale"
  | "engine-unavailable"
  | "engine-build-stale"
  | "runtime-on-cpu";

/**
 * `blocking` means the install is not doing its job right now;
 * `warning` means it is, and something will bite later. The badge counts
 * both and colours by the worst — a person should not have to open a
 * panel to find out whether anything is actually down.
 */
export type IssueSeverity = "blocking" | "warning";

/** The one issue that can be fixed from inside the list. Everything else
 * links to the screen that owns the fix, because a one-click remedy for
 * something with consequences belongs beside the words that explain
 * them. */
export type IssueAction = "unlock-control-root";

export interface Issue {
  /** Stable across polls, so React keys and the open/closed state hold. */
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  /** One line, in the person's words. No `runtime`, no `epoch`, no
   * `advertiseUrl` — S8's banned list applies here first, because this
   * is the text somebody reads when they are already unhappy. */
  title: string;
  /** What to do about it. Never empty: an issue with no next step is a
   * status light, and this project has enough of those. */
  detail: string;
  /** Where the fix is. */
  href: string;
  action?: IssueAction;
  /** Which machine, when it is about one. */
  node?: string | null;
}

/** One node's own reads. Every field is null when that read did not
 * answer, and a null contributes no issues rather than an issue about
 * itself: a list that grows when a component is briefly down is a list
 * people learn to ignore. */
export interface NodeFacts {
  /** Install name, or null on a standalone host that has never enrolled. */
  name: string | null;
  /** What to print. */
  label: string;
  local: boolean;
  identity: NodeIdentity | null;
  /**
   * `performance.now()`-style millisecond marks bracketing the identity
   * read: `before` the request went out, `after` the answer arrived.
   * The clock comparison needs them — see `clockSkewIssue`.
   */
  readWindow: { before: number; after: number } | null;
  runtimes: RuntimeList | null;
  engines: EngineList | null;
  folders: LibraryFolderReach | null;
  /**
   * What this machine's agent supervises, and how each one is doing.
   *
   * Added for R1.5 (review §6.1 #7). The gateway's driver list says
   * nothing about the gateway, and the control root's
   * `ComponentPlacement` carries no `lastError` — so the only place a
   * crash-looping component's own diagnosis exists is the owning
   * agent's `GET /v1/components`, which no golden-path screen read.
   */
  components: ComponentList | null;
}

/** A row of the control root's `GET /v1/nodes`, narrowed to what this
 * module reads. Declared here rather than imported so the aggregator
 * can be driven with the literal bodies a live root returns. */
export interface ControlNodeRow {
  name: string;
  reachable?: boolean | null;
  lastError?: string | null;
  /** Absent with no `lastError` means the root has not probed this node
   * since it started -- see `nodeLiveness`. */
  lastSeenAt?: string | null;
  devices?: ComputeDevice[] | null;
}

export interface IssueSources {
  /** The gateway's view of the control root, which is a routing refresh
   * old and is the one place a sealed root is visible without asking the
   * root itself. */
  controlRoot: ControlRootView | null | undefined;
  /**
   * Whether the control root answered *this browser* with the sealed
   * 503. Read directly rather than inferred from the gateway, because
   * the gateway may be the thing that is down, and because the operator
   * unlocking it needs the answer to be current rather than up to a
   * refresh old.
   */
  controlLocked: boolean;
  /** The control root's node list; null when it did not answer. */
  nodes: ControlNodeRow[] | null;
  /** One entry per node the console can reach. */
  perNode: NodeFacts[];
}

/**
 * Two hosts' clocks may differ by this much before anything is said.
 *
 * The leeway every component applies to `iat` is 300 s
 * (`CLOCK_SKEW_LEEWAY_SECONDS`), past which one host starts refusing the
 * other's tokens and the install comes apart. 30 s is a tenth of that:
 * far enough above the round-trip noise of a proxy hop that it is never
 * a false alarm, far enough below the cliff to be a warning rather than
 * a post-mortem.
 */
export const SKEW_WARN_SECONDS = 30;

/** Past this the install is at the edge of refusing its own traffic. */
export const SKEW_BLOCKING_SECONDS = 240;

/**
 * A machine that joined an install takes the control root's list of
 * trusted keys every minute (per-node token keys, 2026-09-25). Ten
 * minutes without it is ten missed pulls: the machine keeps working with
 * what it last heard, but a machine removed from the install, or a
 * sign-out, since then is not known there. The age is reported by the
 * machine itself and never enforced -- a dead root must not stop the
 * install serving -- so this is where it becomes something to act on.
 */
export const TRUST_STALE_SECONDS = 600;

export function issuesFrom(sources: IssueSources): Issue[] {
  const issues: Issue[] = [
    ...sealedRootIssue(sources),
    ...nodeDownIssues(sources.nodes),
    ...clockSkewIssues(sources.perNode),
  ];
  for (const node of sources.perNode) {
    issues.push(
      ...componentDownIssues(node),
      ...trustStaleIssues(node),
      ...folderIssues(node),
      ...engineIssues(node),
      ...staleBuildIssues(node),
      ...cpuRuntimeIssues(node),
    );
  }
  return issues.sort(bySeverityThenId);
}

/** Blocking first, then by id so the order does not move between polls. */
function bySeverityThenId(a: Issue, b: Issue): number {
  if (a.severity !== b.severity) return a.severity === "blocking" ? -1 : 1;
  return a.id.localeCompare(b.id);
}

export function worstSeverity(issues: Issue[]): IssueSeverity | null {
  if (issues.length === 0) return null;
  return issues.some((i) => i.severity === "blocking") ? "blocking" : "warning";
}

// --- the control root ---------------------------------------------------

/**
 * A sealed root is the issue this slice is measured by, and it is the
 * one this install has actually produced: a container has no OS keyring,
 * so the root comes back holding the install's signing key sealed after
 * every restart. Agent, gateway and control all answer `ok`; control's
 * own health even reports `initialized: true, nodes: 2, epoch: 1`, all
 * true, because the log is intact and only the seal is shut. What does
 * not work is everything — the gateway cannot read the topology and
 * `GET /v1/models` comes back empty with no reason.
 *
 * Two sources, because either can be the one that is available. A direct
 * 503 from the root is current and survives a gateway that is down; the
 * gateway's `control_root` view survives a root this browser cannot
 * reach at all. One issue either way.
 *
 * **The root's own answer wins whenever there is one** (2026-09-23). The
 * gateway's view is a routing refresh old -- up to fifteen seconds -- and
 * these used to be OR'd, so the re-read an unlock pulls forward found the
 * root open, found the gateway still saying `Locked`, and left the issue
 * on screen for the rest of the poll interval. Reported from the live
 * install as "it rarely updates without an F5". A root that answered this
 * browser's roster read is not sealed, whatever the gateway last heard.
 */
function sealedRootIssue(sources: IssueSources): Issue[] {
  const rootAnswered = sources.nodes !== null;
  const fromGateway =
    !rootAnswered &&
    sources.controlRoot?.reachable === false &&
    typeof sources.controlRoot.error === "string" &&
    /locked/i.test(sources.controlRoot.error);
  if (!sources.controlLocked && !fromGateway) return [];
  return [
    {
      id: "control-sealed",
      kind: "control-sealed",
      severity: "blocking",
      title: "The control root is locked",
      detail:
        "It holds this install's keys sealed and has not been given the passphrase since it " +
        "last started, which is what happens on every restart of a machine with no key store. " +
        "Nothing is lost, and nothing else will work until it is unlocked.",
      href: "/nodes",
      action: "unlock-control-root",
    },
  ];
}

// --- nodes --------------------------------------------------------------

/**
 * `reachable: false` used to be the whole message, and it sent an
 * operator looking at enrollment, keys and firewalls when the cause was
 * half a second of clock drift. `lastError` carries the refusing agent's
 * own words now; this prints them rather than a category.
 */
/**
 * **A node the root has not probed yet is not down** (2026-09-23). A
 * sealed root cannot poll, so for about a second after an unlock every
 * node reads `reachable: false` with no reason and no `lastSeenAt` -- and
 * that is exactly when the unlock's own re-read lands. The Nodes page has
 * rendered that state as "checking…" since 2026-09-17 (`nodeLiveness`);
 * this list reported it as every machine in the install going down at
 * the moment it came back.
 */
function nodeDownIssues(nodes: ControlNodeRow[] | null): Issue[] {
  return (nodes ?? [])
    .filter(
      (n) =>
        n.reachable === false &&
        nodeLiveness({ reachable: false, lastError: n.lastError, lastSeenAt: n.lastSeenAt }) ===
          "down",
    )
    .map((n) => ({
      id: `node-down:${n.name}`,
      kind: "node-down" as const,
      severity: "blocking" as const,
      title: `${n.name} is not answering`,
      detail: n.lastError
        ? `The last attempt to reach it said: ${n.lastError}`
        : "Nothing has come back from it, and no reason was recorded. Check that the machine " +
          "is on and that Eugene is running there.",
      href: "/nodes",
      node: n.name,
    }));
}

// --- clocks -------------------------------------------------------------

/**
 * What two machines disagree by, bounded by the round trip.
 *
 * Each node's `time` was read inside a window this browser timed, so the
 * true offset of that host's clock from this browser's is somewhere in
 * `[time - after, time - before]`. Subtracting two such intervals gives
 * an interval for the offset *between the two hosts*, and the reported
 * skew is the smallest magnitude that interval allows — the claim the
 * measurement supports, never the flattering middle of it. A slow proxy
 * hop widens the interval, which makes the reported number smaller, so
 * network latency can only ever hide a skew and never invent one.
 *
 * **Between nodes, never between a node and the browser.** A laptop that
 * has been asleep, or a VM whose clock jumped, would otherwise accuse
 * every machine in the install of being wrong. What breaks an install is
 * two *hosts* disagreeing — the tokens one mints and the other refuses —
 * and a single-machine install has one clock and cannot have the
 * problem at all.
 */
export function skewBetween(a: NodeFacts, b: NodeFacts): number | null {
  const first = offsetInterval(a);
  const second = offsetInterval(b);
  if (first === null || second === null) return null;
  // The difference of two intervals, then the closest point to zero in
  // it: zero if the interval straddles zero, otherwise the nearer end.
  const low = first.low - second.high;
  const high = first.high - second.low;
  if (low <= 0 && high >= 0) return 0;
  return low > 0 ? low : high;
}

function offsetInterval(node: NodeFacts): { low: number; high: number } | null {
  const reported = node.identity?.time;
  const window = node.readWindow;
  if (!reported || !window) return null;
  const at = Date.parse(reported);
  if (Number.isNaN(at)) return null;
  // Seconds, and signed: positive means this host's clock is ahead of
  // the browser's.
  return { low: (at - window.after) / 1000, high: (at - window.before) / 1000 };
}

function clockSkewIssues(perNode: NodeFacts[]): Issue[] {
  const measured = perNode.filter((n) => offsetInterval(n) !== null);
  if (measured.length < 2) return [];

  let worst: { a: NodeFacts; b: NodeFacts; seconds: number } | null = null;
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i]!;
      const b = measured[j]!;
      const seconds = skewBetween(a, b);
      if (seconds === null) continue;
      const magnitude = Math.abs(seconds);
      if (worst === null || magnitude > Math.abs(worst.seconds)) worst = { a, b, seconds };
    }
  }
  if (worst === null || Math.abs(worst.seconds) < SKEW_WARN_SECONDS) return [];

  // Name the one that is ahead first: that is the host whose tokens the
  // other refuses, which is the direction the symptom appears in.
  const ahead = worst.seconds > 0 ? worst.a : worst.b;
  const behind = worst.seconds > 0 ? worst.b : worst.a;
  const seconds = Math.abs(worst.seconds);
  const blocking = seconds >= SKEW_BLOCKING_SECONDS;
  return [
    {
      id: "clock-skew",
      kind: "clock-skew",
      severity: blocking ? "blocking" : "warning",
      title: `${ahead.label} and ${behind.label} disagree about the time by ${formatSkew(seconds)}`,
      detail:
        `${ahead.label}'s clock is ahead. Machines here tolerate five minutes of difference; ` +
        `past that they start refusing each other's sign-ins, which looks like a machine being ` +
        `down for no reason. Turn on automatic time setting on both` +
        (blocking ? " — this install is close to the limit." : "."),
      href: "/nodes",
    },
  ];
}

function trustStaleIssues(node: NodeFacts): Issue[] {
  const identity = node.identity;
  if (!identity?.enrolled) return [];
  const age = identity.trustBundleAgeSeconds;
  if (typeof age !== "number" || age < TRUST_STALE_SECONDS) return [];
  return [
    {
      id: `trust-stale:${node.name ?? node.label}`,
      kind: "trust-stale",
      severity: "warning",
      title: `${node.label} has not heard from the control root for ${formatAge(age)}`,
      detail:
        "It keeps working with what it last heard. A machine removed from the install, " +
        "or a sign-out, since then is not known there yet. Check that it can reach the control root.",
      href: "/nodes",
      node: node.name,
    },
  ];
}

function formatAge(seconds: number): string {
  if (seconds < 90 * 60) return formatSkew(seconds);
  const hours = seconds / 3600;
  if (hours < 36) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

function formatSkew(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  return `${minutes >= 10 ? Math.round(minutes) : minutes.toFixed(1)} minutes`;
}

// --- components ---------------------------------------------------------

/** Plain names for the four kinds, because "inference-driver" is our
 * word and `gateway` reads as jargon on a card somebody opens when they
 * are already unhappy. */
const COMPONENT_LABELS: Record<string, string> = {
  gateway: "The gateway",
  library: "The model library",
  control: "The control root",
  "inference-driver": "A backend connection",
};

/** Where each kind is configured. A driver's port and command live on
 * the Inference screen; the three singletons have a Config page each. */
function componentHref(component: Component): string {
  if (component.kind === "inference-driver") return "/inference";
  return `/config?sel=${encodeURIComponent(String(component.kind))}`;
}

/**
 * A component the agent supervises that is not running.
 *
 * **The issue kind this list needed most, and the one it did not have**
 * (R1.5, review §6.1 #7). Take 8080 — the commonest occupied port on any
 * development box — before first-run setup, and the wizard *completes*:
 * the gateway crash-loops, `GET /v1/models` is empty, Home offers
 * nothing routable, Try it never appears, and the Needs-attention card
 * says **nothing**. The diagnosis existed the whole time, in
 * `Component.lastError`, and `ports.explain_collision` had already
 * turned it into a sentence naming the port and the holding process. No
 * screen on the golden path rendered it.
 *
 * **`starting` is excluded and that is not a detail.** Every boot passes
 * through it, so counting it would put a blocking issue on every install
 * for the first seconds after every restart — which is how a list of
 * things needing attention becomes a list people close. `exited` is
 * excluded for the same reason: the contract calls it a transient state
 * the agent is in the middle of respawning out of.
 *
 * `safe_mode` is a warning rather than blocking: the process is up and
 * answering, it is just running on defaults instead of its own config,
 * which is a thing to fix rather than a thing that is broken now.
 */
function componentDownIssues(node: NodeFacts): Issue[] {
  const out: Issue[] = [];
  for (const component of node.components?.components ?? []) {
    const name = COMPONENT_LABELS[String(component.kind)] ?? component.name;
    if (component.status === "safe_mode") {
      out.push({
        id: `component-safe-mode:${node.name ?? "local"}:${component.name}`,
        kind: "component-down",
        severity: "warning",
        title: `${name} is running on default settings`,
        detail:
          "It was started with its own configuration ignored, so it will not do its real " +
          "job until that is fixed and it is restarted.",
        href: componentHref(component),
        node: node.name,
      });
      continue;
    }
    if (component.status !== "crashed" && component.status !== "unreachable") continue;
    out.push({
      id: `component-down:${node.name ?? "local"}:${component.name}`,
      kind: "component-down",
      severity: "blocking",
      title: `${name} is not running on ${node.label}`,
      detail: component.lastError
        ? `It stopped and has not come back. The last thing it said was: ${component.lastError}`
        : "It is not answering, and no reason was recorded. Its own log, beside the " +
          "configuration file, is the next place to look.",
      href: componentHref(component),
      node: node.name,
    });
  }
  return out;
}

// --- library folders ----------------------------------------------------

/**
 * A folder a node cannot open is a model that node cannot run, and until
 * `library-folders-and-reach` it was discovered at launch time as a
 * spawn failure. The check endpoint answers it directly, per node, and
 * says which rule decided — so this reports the machine, the folder and
 * the path that machine actually tried.
 */
function folderIssues(node: NodeFacts): Issue[] {
  const reach = node.folders;
  if (!reach || reach.libraryConsulted === false) return [];
  return (reach.folders ?? [])
    .filter((f) => f.exists === false || f.isDirectory === false || Boolean(f.problem))
    .map((f) => ({
      id: `folder:${node.name ?? "local"}:${f.path}`,
      kind: "folder-unreachable" as const,
      severity: "blocking" as const,
      title: `${node.label} cannot open the model folder ${f.path}`,
      detail:
        (f.problem ? `${f.problem} ` : "") +
        (f.localPath
          ? `It looked in ${f.localPath}. `
          : "No path on this machine has been set for it. ") +
        "Set where this machine finds that folder, or mount the share there.",
      href: `/library/folders?sel=library:${encodeURIComponent(node.name ?? "")}`,
      node: node.name,
    }));
}

// --- engines ------------------------------------------------------------

/**
 * An engine we would install and cannot.
 *
 * **`policy: manual` is excluded, and that exclusion is the whole
 * subtlety.** vLLM's `installable` is false on every host that ever
 * runs, because its unit of installation is a Python environment we do
 * not own — so a rule that flagged every `installable: false` would put
 * a permanent, unfixable issue on every install in existence, which is
 * how a list of things needing attention becomes a thing nobody reads.
 * What is left is real: a managed engine with no build for this machine,
 * which is llama.cpp on Linux with an NVIDIA card, and a release
 * upstream published with its assets missing.
 */
function engineIssues(node: NodeFacts): Issue[] {
  return (node.engines?.engines ?? [])
    .filter((e) => e.acquisition?.policy === "managed" && e.acquisition?.installable === false)
    .map((e) => ({
      id: `engine:${node.name ?? "local"}:${e.engine}`,
      kind: "engine-unavailable" as const,
      severity: "warning" as const,
      title: `${engineName(e.engine)} cannot be installed on ${node.label}`,
      detail: e.acquisition?.reason ?? "No build is published that would run on this machine.",
      href: "/inference",
      node: node.name,
    }));
}

/**
 * A model still running on the build it started with.
 *
 * Installing a new engine build never touches a running one — versioned
 * directories, never written in place — and the binary is resolved at
 * spawn. So an upgrade with two replicas serving leaves a mixed-version
 * fleet that the gateway load-balances across, silently, until each is
 * restarted. Nothing detected it before this.
 *
 * Two tests, and the second is why the first is not enough. Against the
 * installed version catches every stale runtime including the only one;
 * against each other catches the case where the engine descriptor did
 * not answer, or where the operator upgraded after *both* replicas
 * started and neither matches anything.
 */
function staleBuildIssues(node: NodeFacts): Issue[] {
  const running = (node.runtimes?.runtimes ?? []).filter(
    (r) => r.engineVersion && isLive(r.status),
  );
  if (running.length === 0) return [];
  const installed = new Map<string, string>();
  for (const e of node.engines?.engines ?? []) {
    if (e.engine && e.version) installed.set(e.engine, e.version);
  }

  const out: Issue[] = [];
  const byEngine = new Map<string, Runtime[]>();
  for (const r of running) {
    const key = String(r.engine ?? "");
    byEngine.set(key, [...(byEngine.get(key) ?? []), r]);
  }

  for (const [engine, group] of byEngine) {
    const current = installed.get(engine);
    const stale = current ? group.filter((r) => r.engineVersion !== current) : [];
    if (stale.length > 0) {
      out.push({
        id: `stale-build:${node.name ?? "local"}:${engine}`,
        kind: "engine-build-stale",
        severity: "warning",
        title:
          stale.length === 1
            ? `${label(stale[0]!)} is running on ${engineName(engine)} ${stale[0]!.engineVersion}, not the ${current} that is installed`
            : `${stale.length} models on ${node.label} are running on an older ${engineName(engine)} than the ${current} that is installed`,
        detail:
          "Restarting them picks up the new build. Until then the gateway is sharing requests " +
          "between two different versions of the engine, which is the sort of difference that " +
          "shows up as one model being mysteriously slower than another.",
        href: "/inference",
        node: node.name,
      });
      continue;
    }
    // No installed version to compare against: do the replicas at least
    // agree with each other?
    const versions = new Set(group.map((r) => r.engineVersion));
    if (!current && versions.size > 1) {
      out.push({
        id: `stale-build:${node.name ?? "local"}:${engine}`,
        kind: "engine-build-stale",
        severity: "warning",
        title: `${node.label} is running two versions of ${engineName(engine)} at once`,
        detail: `${[...versions].join(" and ")} are both serving. Restart the models so they all run the same build.`,
        href: "/inference",
        node: node.name,
      });
    }
  }
  return out;
}

// --- runtimes on the processor -----------------------------------------

/**
 * A model on the processor while the machine it is on has a card.
 *
 * Only this case: a machine with no accelerator is not an issue, it is a
 * machine, and every model on it runs on the processor permanently and
 * correctly. The one that needs a person is the profile that asked for
 * no offload on a box that has 32 GB of VRAM idle beside it — measured
 * from the declaration, because no engine reports where its weights
 * actually went.
 */
function cpuRuntimeIssues(node: NodeFacts): Issue[] {
  if (!hasAccelerator(node.identity?.devices ?? [])) return [];
  return (node.runtimes?.runtimes ?? [])
    .filter((r) => isLive(r.status) && declaresNoOffload(r))
    .map((r) => ({
      id: `on-cpu:${node.name ?? "local"}:${r.name}`,
      kind: "runtime-on-cpu" as const,
      severity: "warning" as const,
      title: `${label(r)} is running on the processor, not the graphics card`,
      detail:
        `${node.label} has a card that is not being used for it, because this model's settings ` +
        "put no layers on the graphics card. Expect it to be many times slower than it needs " +
        "to be. Raise the GPU layers in its settings and restart it.",
      href: "/inference",
      node: node.name,
    }));
}

/**
 * Whether a declaration asks for nothing on the accelerator.
 *
 * The agent's own reading, restated: `gpuLayers` unset is *full* offload
 * for llama.cpp (upstream's default), a negative value is "all", and 99
 * or more is full — so the only thing that means the processor is an
 * explicit zero. vLLM has no partial offload at all and never qualifies.
 * Getting this backwards would put a warning on every correctly
 * configured model in the install, which is worse than saying nothing.
 */
export function declaresNoOffload(runtime: Runtime): boolean {
  if (runtime.engine !== "llama_cpp") return false;
  const layers = (runtime.flags ?? {})["gpuLayers"];
  if (layers === undefined || layers === null) return false;
  const count = Number(layers);
  return Number.isFinite(count) && count === 0;
}

export function hasAccelerator(devices: ComputeDevice[]): boolean {
  return devices.some((d) => d.kind !== "cpu");
}

// --- shared ------------------------------------------------------------

/** Engine ids as a person says them. The same map the tray uses; two
 * copies of three strings rather than a dependency between a tray and an
 * issues list, which have nothing else to say to each other. */
const ENGINE_NAME: Record<string, string> = {
  llama_cpp: "llama.cpp",
  vllm: "vLLM",
  mlx: "MLX",
};

export function engineName(engine: string | null | undefined): string {
  if (!engine) return "the engine";
  return ENGINE_NAME[engine] ?? engine;
}

/** The model as a person named it, falling back to what we called the
 * process. */
function label(runtime: Runtime): string {
  return runtime.modelAlias || runtime.name;
}

/** Running, in any of the senses that mean a process is alive. A
 * `stopped` runtime on the processor is not slow, it is off. */
function isLive(status: string | null | undefined): boolean {
  return status === "ready" || status === "loading" || status === "starting";
}

// --- what the Inference screen says about one runtime ------------------

export type ComputeLine = {
  tone: "muted" | "warn";
  text: string;
  /** A tooltip: why we can say this. */
  detail: string;
};

/**
 * *on CPU — reason*, the second of S7's two honest states on Inference.
 *
 * **Nothing reports where a model's weights actually went.** Neither
 * llama.cpp's `/props` nor vLLM's model list carries a device breakdown,
 * and `RuntimeCapabilities` — which is deliberately read back from the
 * engine rather than inferred — has `contextLength`, `parallelSlots`,
 * `embeddings` and `multimodal` and nothing about memory. So this is
 * built from the two things that *are* known, and says which one it
 * used: the machine's own device list, and the declaration the engine
 * was spawned with. A third case, a CPU-only engine build on a machine
 * with a card, is the one that is not observable at all; see this
 * module's header.
 */
export function describeCompute(
  runtime: { engine?: string | null; flags?: Record<string, unknown> | null },
  devices: ComputeDevice[] | null,
): ComputeLine | null {
  if (devices === null) return null;
  if (!hasAccelerator(devices)) {
    return {
      tone: "muted",
      text: "on the processor",
      detail:
        "This machine reports no graphics card, so everything on it runs on the processor. " +
        "That is not a fault; it is slower than a card and it is what this machine has.",
    };
  }
  if (declaresNoOffload(runtime as Runtime)) {
    return {
      tone: "warn",
      text: "on the processor — its settings put no layers on the card",
      detail:
        "GPU layers is 0 in this model's settings, so the card on this machine is not used " +
        "for it. No engine reports where its weights went; this is read from what it was " +
        "started with.",
    };
  }
  return null;
}

/**
 * *loading · N so far*, the first of S7's two honest states — now with a
 * real percentage when, and only when, there is one.
 *
 * **S7 refused a progress bar and was half right.** Its reasoning was
 * that nothing on any wire counts a model load — `llama-server`'s
 * `/health` answers 503 with `{"status": "loading model"}` and no
 * fraction, vLLM answers nothing at all — and that the process's own I/O
 * counters would not rescue it, because llama.cpp memory-maps the file
 * and faulted pages are not read I/O.
 *
 * That last clause is true of a *mapped* load and false of a buffered
 * one. Measured 2026-09-17 on Windows, 268 MB touched: `+268.4 MB` of
 * `ReadTransferCount` for a normal read, over SMB and on local disk
 * alike, and `+0.0 MB` for the same bytes through a mapping. llama.cpp
 * takes `--load-mode none` and vLLM reads normally, so the answer is
 * per-launch. The agent samples the counter, decides whether the bytes
 * are actually moving, and sends `loadProgress` only when they are.
 *
 * **So this function never infers one mode from the other.** Progress
 * present → a percentage, a rate and a real estimate. Absent → exactly
 * what S7 built: elapsed, which is exact, *where it is reading from*,
 * which is what actually explains a four-minute load, and an estimate
 * only once this browser has watched the same model load before.
 */
export interface LoadingDescription {
  text: string;
  /** 0-1 for a bar, or null when there is nothing honest to fill it with. */
  percent: number | null;
}

export function describeLoading(
  runtime: {
    status?: string | null;
    lastRestart?: string | null;
    localPath?: string | null;
    loadProgress?: {
      bytesRead?: number | null;
      totalBytes?: number | null;
      bytesPerSecond?: number | null;
    } | null;
  },
  now: number,
  rememberedSeconds: number | null,
): LoadingDescription | null {
  if (runtime.status !== "loading" && runtime.status !== "starting") return null;

  const from = remotePath(runtime.localPath ?? null);
  const progress = runtime.loadProgress;

  if (progress && typeof progress.bytesRead === "number" && progress.bytesRead >= 0) {
    const read = progress.bytesRead;
    const total = typeof progress.totalBytes === "number" ? progress.totalBytes : null;
    const rate =
      typeof progress.bytesPerSecond === "number" && progress.bytesPerSecond > 0
        ? progress.bytesPerSecond
        : null;
    const percent = total && total > 0 ? Math.min(1, read / total) : null;
    const parts: string[] = [];

    // The read finishes before the engine is ready — the weights still
    // have to reach the GPU. Letting the bar sit at 100% saying
    // "24.9 GB of 24.9 GB" for twenty seconds is the "is it stuck?" this
    // exists to answer, so the last stretch says what is happening.
    if (percent !== null && percent >= 0.999) {
      parts.push("read; uploading to the GPU");
    } else {
      parts.push(
        total ? `${formatBytes(read)} of ${formatBytes(total)}` : `${formatBytes(read)} read`,
      );
      if (rate) parts.push(`${formatBytes(rate)}/s`);
      if (total && rate) {
        const left = (total - read) / rate;
        if (left >= 1) parts.push(`about ${formatElapsed(left)} left`);
      }
    }
    if (from) parts.push(`reading from ${from}`);
    return { text: parts.join(" · "), percent };
  }

  const started = runtime.lastRestart ? Date.parse(runtime.lastRestart) : NaN;
  const parts: string[] = [];
  if (!Number.isNaN(started) && now >= started) {
    const elapsed = (now - started) / 1000;
    parts.push(`${formatElapsed(elapsed)} so far`);
    if (rememberedSeconds !== null && rememberedSeconds > elapsed) {
      parts.push(`about ${formatElapsed(rememberedSeconds - elapsed)} left, going by last time`);
    }
  }
  if (from) parts.push(`reading from ${from}`);
  return parts.length > 0 ? { text: parts.join(" · "), percent: null } : null;
}

/**
 * The share a model is being read across, when it is on one.
 *
 * A UNC path or a drive letter that is not the system one usually means
 * the bytes are crossing a network, and a person watching a progress-less
 * "loading" for four minutes deserves to know that before they conclude
 * the product is broken. A local path is not printed: it explains
 * nothing and is long.
 */
function remotePath(localPath: string | null): string | null {
  if (!localPath) return null;
  if (localPath.startsWith("\\\\") || localPath.startsWith("//")) {
    const parts = localPath.replace(/^[\\/]+/, "").split(/[\\/]/);
    return parts[0] ? `\\\\${parts[0]}` : null;
  }
  return null;
}

/** Decimal units, because that is what a NAS, a disk and a link are all
 * sold in, and a load is bounded by one of those three. */
function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} kB`;
  return `${Math.round(bytes)} B`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 && minutes < 10 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * The copy a node is making of a model, while it is making it.
 *
 * Shares `LoadingDescription` with `describeLoading` because the screen
 * draws them the same way, and is a **separate function** because the
 * two answer different questions and one of them can always be answered.
 * A load's bytes are invisible whenever the engine maps its model, so
 * `loadProgress` is absent most of the time and the caller falls back to
 * elapsed. A copy is made by the agent itself, so if a copy is running
 * there are always bytes — and if there are none, something is wrong
 * rather than unobservable.
 *
 * Design: `docs/design/node-local-model-copy.md` §7.
 */
export function describeCopying(runtime: {
  status?: string | null;
  copyProgress?: {
    bytesCopied?: number | null;
    totalBytes?: number | null;
    bytesPerSecond?: number | null;
    destination?: string | null;
  } | null;
}): LoadingDescription | null {
  if (runtime.status !== "copying") return null;
  const progress = runtime.copyProgress;
  if (!progress || typeof progress.bytesCopied !== "number" || progress.bytesCopied < 0) {
    // The status without the numbers: still worth a line, because
    // "copying" with nothing after it beats a blank cell, and it is the
    // honest report of a poll that caught the job between its start and
    // its first sample.
    return { text: "copying the model to this machine", percent: null };
  }
  const copied = progress.bytesCopied;
  const total = typeof progress.totalBytes === "number" ? progress.totalBytes : null;
  const rate =
    typeof progress.bytesPerSecond === "number" && progress.bytesPerSecond > 0
      ? progress.bytesPerSecond
      : null;
  const percent = total && total > 0 ? Math.min(1, copied / total) : null;
  const parts: string[] = [
    total ? `${formatBytes(copied)} of ${formatBytes(total)}` : `${formatBytes(copied)} copied`,
  ];
  if (rate) parts.push(`${formatBytes(rate)}/s`);
  if (total && rate) {
    const left = (total - copied) / rate;
    if (left >= 1) parts.push(`about ${formatElapsed(left)} left`);
  }
  parts.push("copying to this machine");
  return { text: parts.join(" · "), percent };
}

/** Where a runtime opens its model, and why it is not the local copy. */
export interface ModelSourceDescription {
  text: string;
  /** The reason a copy was asked for and not used; worth reading twice. */
  note: string | null;
}

/**
 * Which file this runtime opens, in the person's words.
 *
 * The four sources are one enum on the wire and three different stories
 * to a person: the copy on this machine, the folder as the Library
 * states it, a mount this machine inherited, or an override typed for
 * this machine alone. `note` is the one that matters most and appears
 * least: a copy that was asked for and skipped leaves the model serving
 * normally over the network, so without saying so the only symptom is a
 * start that is minutes slower than expected.
 */
export function describeModelSource(runtime: {
  localPathSource?: string | null;
  localPath?: string | null;
  localPathNote?: string | null;
}): ModelSourceDescription | null {
  const note = runtime.localPathNote ?? null;
  switch (runtime.localPathSource) {
    case "copy":
      return { text: "reading a local copy on this machine", note: null };
    case "inherited":
    case "override":
    case "same_path": {
      const share = remotePath(runtime.localPath ?? null);
      return {
        text: share ? `reading from ${share}` : "reading from the model folder",
        note,
      };
    }
    default:
      return note ? { text: "reading from the model folder", note } : null;
  }
}
