/**
 * The rules behind the Issues list, against the bodies the live install
 * returns.
 *
 * Every fixture here is a shape something really sends: the gateway's
 * `control_root` view as `controlRoot.test.ts` took it off the wire, the
 * control root's node rows with the `lastError` that was added the
 * morning half a second of clock drift took a worker out of the install,
 * the folder check from the two-machine run, and llama.cpp's own
 * "release has no asset" refusal. Parsed from JSON so a fixture cannot
 * drift into a shape no component produces.
 *
 * **Two rules are sabotage-checked because getting them backwards is
 * worse than saying nothing**, and each says so at its own test:
 * `declaresNoOffload` (unset is *full* offload, not CPU) and the
 * `policy: manual` exclusion (vLLM is uninstallable on every host that
 * will ever run, by decision).
 */

import { describe, expect, it } from "vitest";

import {
  SKEW_BLOCKING_SECONDS,
  SKEW_WARN_SECONDS,
  declaresNoOffload,
  describeCompute,
  describeLoading,
  hasAccelerator,
  issuesFrom,
  skewBetween,
  worstSeverity,
  type ControlNodeRow,
  type Issue,
  type IssueSources,
  type NodeFacts,
} from "./issues";
import type {
  ComputeDevice,
  ControlRootView,
  EngineList,
  LibraryFolderReach,
  NodeIdentity,
  Runtime,
  RuntimeList,
} from "./types";

/** A wire body, parsed rather than written as an object literal, so the
 * test meets what the component sends instead of what the type allows. */
function body<T>(json: string): T {
  return JSON.parse(json) as T;
}

const NOTHING: IssueSources = {
  controlRoot: null,
  controlLocked: false,
  nodes: null,
  perNode: [],
};

/** One node's reads, all absent unless a test supplies them. */
function facts(over: Partial<NodeFacts> & Pick<NodeFacts, "name" | "label">): NodeFacts {
  return {
    local: false,
    identity: null,
    readWindow: null,
    runtimes: null,
    engines: null,
    folders: null,
    ...over,
  };
}

function kinds(issues: Issue[]): string[] {
  return issues.map((i) => i.kind);
}

// --- nothing, and nothing answering ------------------------------------

describe("issuesFrom with nothing to go on", () => {
  it("is an empty list, not an error", () => {
    expect(issuesFrom(NOTHING)).toEqual([]);
  });

  it("says nothing about a node whose every read failed", () => {
    // A list that grows when a component is briefly down is a list
    // people learn to ignore. A null read contributes no issue, and
    // never an issue about itself.
    expect(
      issuesFrom({
        ...NOTHING,
        perNode: [facts({ name: "Amish_Station", label: "Amish_Station" })],
      }),
    ).toEqual([]);
  });
});

// --- the control root ---------------------------------------------------

const ROOT_LOCKED = body<ControlRootView>(
  '{"source":"agent","url":"http://192.168.16.252:8283/","reachable":false,"error":"503 Locked","nodes":2}',
);
const ROOT_REFUSED = body<ControlRootView>(
  '{"source":"config","url":"http://192.168.16.252:8283","reachable":false,"error":"Connection refused","nodes":2}',
);
const ROOT_HEALTHY = body<ControlRootView>(
  '{"source":"agent","url":"http://192.168.16.252:8283/","reachable":true,"error":null,"nodes":2}',
);

describe("a sealed control root", () => {
  it("is blocking, and carries the one action that can be taken from the list", () => {
    const issues = issuesFrom({ ...NOTHING, controlRoot: ROOT_LOCKED });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("control-sealed");
    expect(issues[0]!.severity).toBe("blocking");
    expect(issues[0]!.action).toBe("unlock-control-root");
    expect(issues[0]!.href).toBe("/nodes");
  });

  it("is found from the browser's own 503 when the gateway is the thing that is down", () => {
    const issues = issuesFrom({ ...NOTHING, controlRoot: null, controlLocked: true });
    expect(kinds(issues)).toEqual(["control-sealed"]);
  });

  it("is one issue when both sources see it, because it is one root", () => {
    const issues = issuesFrom({ ...NOTHING, controlRoot: ROOT_LOCKED, controlLocked: true });
    expect(issues).toHaveLength(1);
  });

  it("is not raised for a root that simply did not answer", () => {
    // "Unreachable" and "sealed" have different remedies, and the root
    // separates them on purpose: flattening them is how a page came to
    // advise wiping an install that only needed a passphrase.
    expect(issuesFrom({ ...NOTHING, controlRoot: ROOT_REFUSED })).toEqual([]);
  });

  it("is not raised for a healthy root", () => {
    expect(issuesFrom({ ...NOTHING, controlRoot: ROOT_HEALTHY })).toEqual([]);
  });

  it("explains itself without naming a seal, an epoch or a key", () => {
    const [issue] = issuesFrom({ ...NOTHING, controlLocked: true });
    expect(issue!.title).toBe("The control root is locked");
    expect(issue!.detail).toContain("passphrase");
    expect(issue!.detail).toContain("Nothing is lost");
  });
});

// --- nodes --------------------------------------------------------------

describe("a node that is not answering", () => {
  it("prints the refusing agent's own words rather than a category", () => {
    // The 2026-09-15 morning this exists for: `reachable: false` with no
    // reason sent an operator looking at enrollment, keys and firewalls
    // when the cause was half a second of clock drift.
    const nodes = body<ControlNodeRow[]>(
      '[{"name":"Amish_Station","reachable":false,' +
        '"lastError":"Unauthorized: The token is not yet valid (iat)"}]',
    );
    const [issue] = issuesFrom({ ...NOTHING, nodes });
    expect(issue!.kind).toBe("node-down");
    expect(issue!.severity).toBe("blocking");
    expect(issue!.title).toBe("Amish_Station is not answering");
    expect(issue!.detail).toContain("The token is not yet valid (iat)");
    expect(issue!.node).toBe("Amish_Station");
  });

  it("says so plainly when no reason was recorded", () => {
    const nodes = body<ControlNodeRow[]>('[{"name":"Amish_Station","reachable":false}]');
    const [issue] = issuesFrom({ ...NOTHING, nodes });
    expect(issue!.detail).toContain("no reason was recorded");
    expect(issue!.detail).toContain("Check that the machine");
  });

  it("leaves a reachable node alone, and a root that reports neither way", () => {
    const nodes = body<ControlNodeRow[]>(
      '[{"name":"eugene-plexus","reachable":true,"lastError":null},{"name":"Amish_Station"}]',
    );
    expect(issuesFrom({ ...NOTHING, nodes })).toEqual([]);
  });
});

// --- clocks -------------------------------------------------------------

const T0 = Date.parse("2026-09-16T14:03:21.000Z");

/**
 * A node that answered `GET /v1/node` inside a window this browser
 * timed. `aheadMs` is how far that host's clock really is from the
 * browser's; `tripMs` is the round trip the read paid.
 */
function timed(name: string, aheadMs: number, startedMs: number, tripMs: number): NodeFacts {
  const before = T0 + startedMs;
  const after = before + tripMs;
  // It answered in the middle of the window, carrying its own clock.
  const reported = new Date(before + tripMs / 2 + aheadMs).toISOString();
  return facts({
    name,
    label: name,
    identity: body<NodeIdentity>(`{"enrolled":true,"name":"${name}","time":"${reported}"}`),
    readWindow: { before, after },
  });
}

describe("skewBetween", () => {
  it("reports zero when two round trips cannot tell the clocks apart", () => {
    // Both hosts agree, and both reads paid two seconds. The offset
    // interval straddles zero, so the claim the measurement supports is
    // "no disagreement" — not the flattering middle of the interval.
    const a = timed("eugene-plexus", 0, 0, 2000);
    const b = timed("Amish_Station", 0, 2100, 2000);
    expect(skewBetween(a, b)).toBe(0);
  });

  it("reports the smallest disagreement the measurement allows", () => {
    const a = timed("eugene-plexus", 45_000, 0, 20);
    const b = timed("Amish_Station", 0, 100, 30);
    // 45 s of real skew, minus the half of each window the reads cost.
    expect(skewBetween(a, b)).toBeCloseTo(44.975, 3);
  });

  it("is signed: positive means the first node's clock is ahead", () => {
    const a = timed("eugene-plexus", 45_000, 0, 20);
    const b = timed("Amish_Station", 0, 100, 30);
    expect(skewBetween(a, b)!).toBeGreaterThan(0);
    expect(skewBetween(b, a)!).toBeLessThan(0);
  });

  it("can only ever hide a skew, never invent one", () => {
    // The same true 45 s, read across a slow hop. A wider window makes
    // the reported number SMALLER, which is the property that lets this
    // be shown to a person without a proxy making a liar of it.
    const quick = skewBetween(timed("a", 45_000, 0, 20), timed("b", 0, 100, 30))!;
    const slow = skewBetween(timed("a", 45_000, 0, 2000), timed("b", 0, 2100, 2000))!;
    expect(slow).toBeLessThan(quick);
    expect(slow).toBeCloseTo(43, 3);
  });

  it("is null when either side did not report a time", () => {
    const a = timed("eugene-plexus", 45_000, 0, 20);
    const b = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      identity: body<NodeIdentity>('{"enrolled":true,"name":"Amish_Station"}'),
      readWindow: { before: T0, after: T0 + 30 },
    });
    expect(skewBetween(a, b)).toBeNull();
  });

  it("is null when a read was not timed", () => {
    // THE TRAP `useIssues.ts` HAS TO AVOID. A node read without
    // `Date.now()` either side of the request contributes no
    // measurement — silently, because there is nothing to complain
    // about. Every test of the skew rule still passes; the rule just
    // never fires on a real install. This is the assertion that says so.
    const a = timed("eugene-plexus", 45_000, 0, 20);
    const untimed = { ...timed("Amish_Station", 0, 100, 30), readWindow: null };
    expect(skewBetween(a, untimed)).toBeNull();
    expect(issuesFrom({ ...NOTHING, perNode: [a, untimed] })).toEqual([]);
  });
});

describe("two machines that disagree about the time", () => {
  it("says nothing on a one-machine install, which has one clock", () => {
    const only = timed("Amish_Station", 600_000, 0, 20);
    expect(issuesFrom({ ...NOTHING, perNode: [only] })).toEqual([]);
  });

  it("says nothing below the warning threshold", () => {
    const a = timed("eugene-plexus", (SKEW_WARN_SECONDS - 10) * 1000, 0, 20);
    const b = timed("Amish_Station", 0, 100, 30);
    expect(issuesFrom({ ...NOTHING, perNode: [a, b] })).toEqual([]);
  });

  it("warns above it, names the host that is ahead first, and says what to do", () => {
    const a = timed("eugene-plexus", 45_000, 0, 20);
    const b = timed("Amish_Station", 0, 100, 30);
    const [issue] = issuesFrom({ ...NOTHING, perNode: [a, b] });
    expect(issue!.kind).toBe("clock-skew");
    expect(issue!.severity).toBe("warning");
    expect(issue!.title).toBe(
      "eugene-plexus and Amish_Station disagree about the time by 45 seconds",
    );
    expect(issue!.detail).toContain("eugene-plexus's clock is ahead");
    expect(issue!.detail).toContain("automatic time setting");
    expect(issue!.detail).not.toContain("close to the limit");
  });

  it("names whichever is ahead, in either argument order", () => {
    const a = timed("eugene-plexus", 0, 0, 20);
    const b = timed("Amish_Station", 45_000, 100, 30);
    const [issue] = issuesFrom({ ...NOTHING, perNode: [a, b] });
    expect(issue!.title).toBe(
      "Amish_Station and eugene-plexus disagree about the time by 45 seconds",
    );
  });

  it("blocks as the install approaches the five minutes it refuses at", () => {
    const a = timed("eugene-plexus", (SKEW_BLOCKING_SECONDS + 60) * 1000, 0, 20);
    const b = timed("Amish_Station", 0, 100, 30);
    const [issue] = issuesFrom({ ...NOTHING, perNode: [a, b] });
    expect(issue!.severity).toBe("blocking");
    expect(issue!.title).toContain("5.0 minutes");
    expect(issue!.detail).toContain("close to the limit");
  });

  it("reports the worst pair once, not one issue per pair", () => {
    const a = timed("eugene-plexus", 0, 0, 20);
    const b = timed("Amish_Station", 45_000, 100, 30);
    const c = timed("workshop", 120_000, 200, 30);
    const issues = issuesFrom({ ...NOTHING, perNode: [a, b, c] });
    expect(kinds(issues)).toEqual(["clock-skew"]);
    expect(issues[0]!.title).toContain("workshop and eugene-plexus");
    expect(issues[0]!.title).toContain("2.0 minutes");
  });
});

// --- library folders ----------------------------------------------------

const FOLDER_OK = body<LibraryFolderReach>(
  String.raw`{"libraryConsulted":true,"folderListAgeSeconds":0,
    "libraryUrl":"http://192.168.16.252:8282/",
    "folders":[{"path":"/models","localPath":"\\\\192.168.16.252\\downloads\\models",
      "source":"inherited","mount":"\\\\192.168.16.252\\downloads\\models",
      "exists":true,"isDirectory":true,"modelsUnder":1,"modelsReachable":1}]}`,
);

const FOLDER_MISSING = body<LibraryFolderReach>(
  String.raw`{"libraryConsulted":true,"folderListAgeSeconds":0,
    "libraryUrl":"http://192.168.16.252:8282/",
    "folders":[{"path":"/models","localPath":"Y:\\models","source":"override",
      "override":{"from":"/models","to":"Y:\\models"},
      "exists":false,"modelsUnder":1,"modelsReachable":0,
      "problem":"Y:\\models does not exist on this host."}]}`,
);

describe("a folder a machine cannot open", () => {
  it("is blocking, and names the machine, the folder and the path it tried", () => {
    const node = facts({ name: "Amish_Station", label: "Amish_Station", folders: FOLDER_MISSING });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.kind).toBe("folder-unreachable");
    expect(issue!.severity).toBe("blocking");
    expect(issue!.title).toBe("Amish_Station cannot open the model folder /models");
    expect(issue!.detail).toContain("does not exist on this host");
    expect(issue!.detail).toContain("It looked in Y:\\models");
    expect(issue!.detail).toContain("mount the share there");
  });

  it("sends the person to that machine's own folder column", () => {
    const node = facts({ name: "Amish_Station", label: "Amish_Station", folders: FOLDER_MISSING });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.href).toBe("/library/folders?sel=library:Amish_Station");
  });

  it("says nothing about a folder that is reachable", () => {
    const node = facts({ name: "Amish_Station", label: "Amish_Station", folders: FOLDER_OK });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("says nothing when the library was not consulted", () => {
    // The rows would be this node's stale copy of the folder list. Our
    // own bookkeeping being out of date is not the person's problem.
    const stale = body<LibraryFolderReach>(
      String.raw`{"libraryConsulted":false,"folders":[{"path":"/models","localPath":"Y:\\models",
        "source":"override","exists":false,"problem":"Y:\\models does not exist on this host."}]}`,
    );
    const node = facts({ name: "Amish_Station", label: "Amish_Station", folders: stale });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("flags a folder that exists but is not a directory", () => {
    const notDir = body<LibraryFolderReach>(
      String.raw`{"libraryConsulted":true,"folders":[{"path":"/models",
        "localPath":"Y:\\models","source":"override","exists":true,"isDirectory":false,
        "problem":"Y:\\models is a file, not a directory."}]}`,
    );
    const node = facts({ name: "Amish_Station", label: "Amish_Station", folders: notDir });
    expect(kinds(issuesFrom({ ...NOTHING, perNode: [node] }))).toEqual(["folder-unreachable"]);
  });
});

// --- engines ------------------------------------------------------------

const VLLM_MANUAL = body<EngineList>(
  '{"engines":[{"engine":"vllm","available":false,"modelFormats":["safetensors"],' +
    '"acquisition":{"policy":"manual","installable":false,' +
    '"reason":"vLLM installs into a Python environment this project does not own."}}]}',
);

const LLAMA_NO_ASSET = body<EngineList>(
  '{"engines":[{"engine":"llama_cpp","available":false,"modelFormats":["gguf"],' +
    '"acquisition":{"policy":"managed","installable":false,' +
    '"reason":"Upstream publishes no CUDA build for Linux. Published variants: ' +
    'linux-vulkan-x64, win-cuda-13.4-x64."}}]}',
);

const LLAMA_FINE = body<EngineList>(
  '{"engines":[{"engine":"llama_cpp","available":true,"version":"b10990",' +
    '"modelFormats":["gguf"],"acquisition":{"policy":"managed","installable":true}}]}',
);

describe("an engine that cannot be installed", () => {
  it("IGNORES policy: manual, on every host, forever", () => {
    // SABOTAGE-CHECKED. vLLM's `installable` is false on every host that
    // will ever run, because its unit of installation is a Python
    // environment we do not own — a decision, not a fault. Drop the
    // `policy === "managed"` filter and this fixture puts a permanent,
    // unfixable issue in front of every user of this product, which is
    // how a needs-attention list becomes a thing nobody reads.
    const node = facts({ name: "Amish_Station", label: "Amish_Station", engines: VLLM_MANUAL });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("warns for a managed engine with no build for this machine, in upstream's words", () => {
    const node = facts({ name: "tower", label: "tower", engines: LLAMA_NO_ASSET });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.kind).toBe("engine-unavailable");
    expect(issue!.severity).toBe("warning");
    expect(issue!.title).toBe("llama.cpp cannot be installed on tower");
    expect(issue!.detail).toContain("no CUDA build for Linux");
    expect(issue!.href).toBe("/inference");
  });

  it("says nothing about an engine that installs fine", () => {
    const node = facts({ name: "Amish_Station", label: "Amish_Station", engines: LLAMA_FINE });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("has something to say even when no reason came back", () => {
    const bare = body<EngineList>(
      '{"engines":[{"engine":"llama_cpp","available":false,"modelFormats":["gguf"],' +
        '"acquisition":{"policy":"managed","installable":false}}]}',
    );
    const node = facts({ name: "tower", label: "tower", engines: bare });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.detail).toBe("No build is published that would run on this machine.");
  });
});

// --- mixed engine builds ------------------------------------------------

function runtimes(json: string): RuntimeList {
  return body<RuntimeList>(json);
}

const TWO_REPLICAS_SPLIT = runtimes(
  '{"runtimes":[' +
    '{"name":"gemma-a","engine":"llama_cpp","modelPath":"/models/gemma-27b-Q6_K_L.gguf",' +
    '"modelAlias":"gemma-3-27b","status":"ready","engineVersion":"b10948"},' +
    '{"name":"gemma-b","engine":"llama_cpp","modelPath":"/models/gemma-27b-Q6_K_L.gguf",' +
    '"modelAlias":"gemma-3-27b","status":"ready","engineVersion":"b10990"}]}',
);

describe("a model left on an older engine build", () => {
  it("names the model, the build it is on and the one installed", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      engines: LLAMA_FINE,
      runtimes: runtimes(
        '{"runtimes":[{"name":"gemma-a","engine":"llama_cpp",' +
          '"modelPath":"/models/gemma-27b-Q6_K_L.gguf","modelAlias":"gemma-3-27b",' +
          '"status":"ready","engineVersion":"b10948"}]}',
      ),
    });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.kind).toBe("engine-build-stale");
    expect(issue!.severity).toBe("warning");
    expect(issue!.title).toBe(
      "gemma-3-27b is running on llama.cpp b10948, not the b10990 that is installed",
    );
    expect(issue!.detail).toContain("Restarting them picks up the new build");
  });

  it("counts them when there is more than one", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      engines: LLAMA_FINE,
      runtimes: runtimes(
        '{"runtimes":[' +
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
          '"engineVersion":"b10948"},' +
          '{"name":"b","engine":"llama_cpp","modelPath":"/m/b.gguf","status":"loading",' +
          '"engineVersion":"b10931"}]}',
      ),
    });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.title).toBe(
      "2 models on Amish_Station are running on an older llama.cpp than the b10990 that is installed",
    );
  });

  it("catches replicas disagreeing with each other when no descriptor answered", () => {
    // The gateway load-balances across these two, silently, so a request
    // lands on one build or the other by coin toss.
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      runtimes: TWO_REPLICAS_SPLIT,
    });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.title).toBe("Amish_Station is running two versions of llama.cpp at once");
    expect(issue!.detail).toContain("b10948 and b10990");
  });

  it("says nothing when every replica is on the installed build", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      engines: LLAMA_FINE,
      runtimes: runtimes(
        '{"runtimes":[' +
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
          '"engineVersion":"b10990"},' +
          '{"name":"b","engine":"llama_cpp","modelPath":"/m/b.gguf","status":"ready",' +
          '"engineVersion":"b10990"}]}',
      ),
    });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("ignores a stopped runtime, which is not running on anything", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      engines: LLAMA_FINE,
      runtimes: runtimes(
        '{"runtimes":[{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf",' +
          '"status":"stopped","engineVersion":"b10948"}]}',
      ),
    });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });
});

// --- a model on the processor ------------------------------------------

const CUDA: ComputeDevice[] = body<ComputeDevice[]>(
  '[{"kind":"cuda","name":"NVIDIA GeForce RTX 5090","index":0,' +
    '"memoryTotalBytes":34262286336,"memoryFreeBytes":31905845248}]',
);

function identityWith(devices: string): NodeIdentity {
  return body<NodeIdentity>(`{"enrolled":true,"name":"Amish_Station","devices":${devices}}`);
}

const ON_CPU = runtimes(
  '{"runtimes":[{"name":"gemma","engine":"llama_cpp","modelPath":"/m/gemma.gguf",' +
    '"modelAlias":"gemma-3-27b","status":"ready","flags":{"gpuLayers":0}}]}',
);

describe("declaresNoOffload", () => {
  function runtime(json: string): Runtime {
    return body<Runtime>(json);
  }

  it("is FALSE when gpuLayers is unset, because unset is full offload", () => {
    // SABOTAGE-CHECKED, and it is the rule most worth getting right in
    // this file. llama.cpp's own default puts every layer on the card,
    // so a declaration that says nothing is a declaration that says
    // "use the GPU". Write this as `!layers`, or as `<= 0`, and every
    // correctly configured model in the install grows a warning telling
    // the person to fix something that is not broken.
    expect(
      declaresNoOffload(
        runtime('{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready"}'),
      ),
    ).toBe(false);
    expect(
      declaresNoOffload(
        runtime(
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready","flags":{}}',
        ),
      ),
    ).toBe(false);
  });

  it("is false for an explicit null, which is also not a zero", () => {
    // Drop the null guard and `Number(null)` is 0: a flag explicitly
    // cleared would read as "on the processor".
    expect(
      declaresNoOffload(
        runtime(
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
            '"flags":{"gpuLayers":null}}',
        ),
      ),
    ).toBe(false);
  });

  it("is true only for an explicit zero", () => {
    expect(
      declaresNoOffload(
        runtime(
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
            '"flags":{"gpuLayers":0}}',
        ),
      ),
    ).toBe(true);
    // The config editor round-trips numbers through strings.
    expect(
      declaresNoOffload(
        runtime(
          '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
            '"flags":{"gpuLayers":"0"}}',
        ),
      ),
    ).toBe(true);
  });

  it("is false for the values that mean all of them", () => {
    // 99 is full offload — M6's live run found the opposite reading in
    // the admission path and it cost a wrong refusal. A negative is
    // upstream's "all".
    for (const value of ["99", "-1", "35", "999"]) {
      expect(
        declaresNoOffload(
          runtime(
            '{"name":"a","engine":"llama_cpp","modelPath":"/m/a.gguf","status":"ready",' +
              `"flags":{"gpuLayers":${value}}}`,
          ),
        ),
      ).toBe(false);
    }
  });

  it("is false for vLLM, which has no partial offload to decline", () => {
    expect(
      declaresNoOffload(
        runtime(
          '{"name":"a","engine":"vllm","modelPath":"/m/a","status":"ready",' +
            '"flags":{"gpuLayers":0}}',
        ),
      ),
    ).toBe(false);
  });
});

describe("hasAccelerator", () => {
  it("is false for nothing, and for a machine that reports only a processor", () => {
    expect(hasAccelerator([])).toBe(false);
    expect(hasAccelerator(body<ComputeDevice[]>('[{"kind":"cpu","name":"AMD Ryzen 9"}]'))).toBe(
      false,
    );
  });

  it("is true for any of the four kinds that are not a processor", () => {
    for (const kind of ["cuda", "rocm", "xpu", "metal"]) {
      expect(hasAccelerator(body<ComputeDevice[]>(`[{"kind":"${kind}"}]`))).toBe(true);
    }
  });
});

describe("a model running on the processor", () => {
  it("is an issue only where there is a card going unused", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      identity: identityWith(JSON.stringify(CUDA)),
      runtimes: ON_CPU,
    });
    const [issue] = issuesFrom({ ...NOTHING, perNode: [node] });
    expect(issue!.kind).toBe("runtime-on-cpu");
    expect(issue!.severity).toBe("warning");
    expect(issue!.title).toBe("gemma-3-27b is running on the processor, not the graphics card");
    expect(issue!.detail).toContain("many times slower");
  });

  it("is NOT an issue on a machine with no card, which is a machine, not a fault", () => {
    const node = facts({
      name: "tower",
      label: "tower",
      identity: identityWith('[{"kind":"cpu","name":"Intel Xeon"}]'),
      runtimes: ON_CPU,
    });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("says nothing when the machine never reported its devices", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      identity: body<NodeIdentity>('{"enrolled":true,"name":"Amish_Station"}'),
      runtimes: ON_CPU,
    });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });

  it("says nothing about a model that is merely stopped", () => {
    const node = facts({
      name: "Amish_Station",
      label: "Amish_Station",
      identity: identityWith(JSON.stringify(CUDA)),
      runtimes: runtimes(
        '{"runtimes":[{"name":"gemma","engine":"llama_cpp","modelPath":"/m/gemma.gguf",' +
          '"status":"stopped","flags":{"gpuLayers":0}}]}',
      ),
    });
    expect(issuesFrom({ ...NOTHING, perNode: [node] })).toEqual([]);
  });
});

// --- severity and order -------------------------------------------------

describe("worstSeverity", () => {
  it("is null for an empty list", () => {
    expect(worstSeverity([])).toBeNull();
  });

  it("is blocking if anything is, so the badge does not need opening", () => {
    const node = facts({ name: "tower", label: "tower", engines: LLAMA_NO_ASSET });
    expect(worstSeverity(issuesFrom({ ...NOTHING, perNode: [node] }))).toBe("warning");
    expect(worstSeverity(issuesFrom({ ...NOTHING, controlLocked: true, perNode: [node] }))).toBe(
      "blocking",
    );
  });
});

describe("the order of the list", () => {
  it("puts what is down above what will bite later, and does not move between polls", () => {
    const sources: IssueSources = {
      controlRoot: ROOT_LOCKED,
      controlLocked: true,
      nodes: body<ControlNodeRow[]>('[{"name":"Amish_Station","reachable":false}]'),
      perNode: [
        facts({
          name: "Amish_Station",
          label: "Amish_Station",
          identity: identityWith(JSON.stringify(CUDA)),
          engines: LLAMA_NO_ASSET,
          folders: FOLDER_MISSING,
          runtimes: ON_CPU,
        }),
      ],
    };
    const issues = issuesFrom(sources);
    expect(kinds(issues)).toEqual([
      "control-sealed",
      "folder-unreachable",
      "node-down",
      "engine-unavailable",
      "runtime-on-cpu",
    ]);
    // Stable: the same bodies give the same order, and the ids are keys.
    expect(issuesFrom(sources).map((i) => i.id)).toEqual(issues.map((i) => i.id));
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
  });

  it("gives every issue somewhere to go and something to do", () => {
    const issues = issuesFrom({
      controlRoot: ROOT_LOCKED,
      controlLocked: false,
      nodes: body<ControlNodeRow[]>('[{"name":"Amish_Station","reachable":false}]'),
      perNode: [
        facts({
          name: "Amish_Station",
          label: "Amish_Station",
          identity: identityWith(JSON.stringify(CUDA)),
          engines: LLAMA_NO_ASSET,
          folders: FOLDER_MISSING,
          runtimes: ON_CPU,
        }),
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.title.length).toBeGreaterThan(0);
      expect(issue.detail.length).toBeGreaterThan(0);
      expect(issue.href.startsWith("/")).toBe(true);
    }
  });
});

// --- what the Inference screen says ------------------------------------

describe("describeCompute", () => {
  it("says nothing at all when the machine's devices are unknown", () => {
    expect(describeCompute({ engine: "llama_cpp" }, null)).toBeNull();
  });

  it("states the permanent case plainly, and does not call it a fault", () => {
    const line = describeCompute({ engine: "llama_cpp" }, []);
    expect(line?.tone).toBe("muted");
    expect(line?.text).toBe("on the processor");
    expect(line?.detail).toContain("not a fault");
  });

  it("warns when a card is there and the settings decline it", () => {
    const line = describeCompute({ engine: "llama_cpp", flags: { gpuLayers: 0 } }, CUDA);
    expect(line?.tone).toBe("warn");
    expect(line?.text).toContain("no layers on the card");
    // Says where the claim comes from, because nothing reports where the
    // weights actually went.
    expect(line?.detail).toContain("read from what it was started with");
  });

  it("says nothing about a model that is using the card", () => {
    expect(describeCompute({ engine: "llama_cpp" }, CUDA)).toBeNull();
    expect(describeCompute({ engine: "llama_cpp", flags: { gpuLayers: 99 } }, CUDA)).toBeNull();
  });
});

describe("describeLoading", () => {
  const started = "2026-09-16T13:59:26.000Z";
  const now = Date.parse(started) + 95_000;

  it("says nothing about a model that is not loading", () => {
    expect(describeLoading({ status: "ready", lastRestart: started }, now, null)).toBeNull();
  });

  it("reports elapsed, which is the only exact thing there is", () => {
    // The design asked for a time remaining from bytes and rate. There
    // are no bytes: nothing on any wire counts a model load, and
    // llama.cpp memory-maps the file so faulted pages are not read I/O.
    expect(describeLoading({ status: "loading", lastRestart: started }, now, null)?.text).toBe(
      "1 min 35 s so far",
    );
  });

  it("names the share the bytes are crossing, which is what explains the wait", () => {
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        localPath: "\\\\192.168.16.252\\downloads\\models\\gemma-27b-Q6_K_L.gguf",
      },
      now,
      null,
    );
    expect(line?.text).toBe("1 min 35 s so far · reading from \\\\192.168.16.252");
  });

  it("does not print a local path, which explains nothing and is long", () => {
    expect(
      describeLoading(
        { status: "loading", lastRestart: started, localPath: "D:\\models\\gemma.gguf" },
        now,
        null,
      )?.text,
    ).toBe("1 min 35 s so far");
  });

  it("estimates only from a load this browser has watched finish before", () => {
    expect(describeLoading({ status: "loading", lastRestart: started }, now, 240)?.text).toBe(
      "1 min 35 s so far · about 2 min 25 s left, going by last time",
    );
  });

  it("stops estimating once the load has outrun what it remembers", () => {
    expect(describeLoading({ status: "loading", lastRestart: started }, now, 60)?.text).toBe(
      "1 min 35 s so far",
    );
  });

  it("says nothing rather than guessing when there is no start time", () => {
    expect(describeLoading({ status: "starting" }, now, null)).toBeNull();
  });
  // ----------------------------------------------------------------- //
  // the bytes, when there are some
  //
  // S7 refused a bar because llama.cpp mmaps and faulted pages are not
  // read I/O. That is still true of a mapped load and false of a
  // buffered one (`--load-mode none`, vLLM), so the agent sends
  // `loadProgress` only where it watched the counter move, and this
  // never infers one mode from the other.
  // ----------------------------------------------------------------- //

  it("fills a bar from real bytes, with a rate and an estimate", () => {
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        loadProgress: {
          bytesRead: 8_200_000_000,
          totalBytes: 24_950_000_000,
          bytesPerSecond: 97_000_000,
        },
      },
      now,
      null,
    );
    expect(line?.percent).toBeCloseTo(0.3286, 3);
    expect(line?.text).toBe("8.2 GB of 25 GB · 97 MB/s · about 2 min 53 s left");
  });

  it("draws NO bar when the agent could not watch the bytes", () => {
    // The load-bearing case. A mapped load sends no progress, and a
    // track with no fill would read as "0%, stuck" -- the exact
    // conclusion this line exists to prevent.
    const line = describeLoading({ status: "loading", lastRestart: started }, now, null);
    expect(line?.percent).toBeNull();
    expect(line?.text).toBe("1 min 35 s so far");
  });

  it("reports bytes without a percentage when the file could not be sized", () => {
    // A share that went away is exactly when a load is worth watching.
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        loadProgress: { bytesRead: 3_000_000_000, totalBytes: null, bytesPerSecond: 50_000_000 },
      },
      now,
      null,
    );
    expect(line?.percent).toBeNull();
    expect(line?.text).toBe("3.0 GB read · 50 MB/s");
  });

  it("says what the last stretch is actually doing instead of sitting at 100%", () => {
    // The read finishes before the engine is ready -- the weights still
    // have to reach the GPU.
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        loadProgress: {
          bytesRead: 24_950_000_000,
          totalBytes: 24_950_000_000,
          bytesPerSecond: 97_000_000,
        },
      },
      now,
      null,
    );
    expect(line?.percent).toBe(1);
    expect(line?.text).toBe("read; uploading to the GPU");
  });

  it("never fills past full, because the counter counts more than the model", () => {
    // `bytesRead` is every byte the process read -- its own binary, the
    // CUDA libraries, the GGUF -- so it genuinely overshoots the model's
    // size on a small model with a large runtime beside it. A bar at
    // 130% reads as broken.
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        loadProgress: { bytesRead: 30_000_000_000, totalBytes: 25_000_000_000, bytesPerSecond: 1 },
      },
      now,
      null,
    );
    expect(line?.percent).toBe(1);
  });

  it("prefers real bytes over what this browser remembers", () => {
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        loadProgress: {
          bytesRead: 5_000_000_000,
          totalBytes: 25_000_000_000,
          bytesPerSecond: 100_000_000,
        },
      },
      now,
      240,
    );
    expect(line?.text).not.toContain("going by last time");
  });

  it("still names the share when it has bytes too", () => {
    const line = describeLoading(
      {
        status: "loading",
        lastRestart: started,
        localPath: "\\\\192.168.16.252\\downloads\\models\\gemma.gguf",
        loadProgress: {
          bytesRead: 1_000_000_000,
          totalBytes: 25_000_000_000,
          bytesPerSecond: 100_000_000,
        },
      },
      now,
      null,
    );
    expect(line?.text).toContain("reading from \\\\192.168.16.252");
  });
});
