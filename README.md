# Eugene Plexus — `ui`

[![CI](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000.svg)](https://nextjs.org)

Web UI for [Eugene Plexus](https://github.com/eugene-plexus): a dashboard for the engine
processes the supervisor runs, a schema-driven config editor for every component, and a chat
playground over the gateway's OpenAI-compatible endpoint.

## Status

**Current through the M9 contracts (2026-09-11).** Runtime dashboard, config editor,
model library and profiles, discovery/downloads with hardware guidance, retained
request metrics, and the playground are wired to the services. The UI generates all
five API documents, including `control`, and proxies to the control root. `/nodes`
is the first control-root screen — it mints a join token and renders the
`eugene-plexus-agent join` command for the machine being added; the workflows past
it are still blocked on whether the agent should own the UI at all.

**A browser drives this now.** `npm run test:e2e` runs Playwright against the system
Chrome and a live install, covering first run, login, restart-on-login and the
topology-resolved proxy — the arc jsdom cannot reach, because it has no layout, no
navigation, no real fetch and no cookie jar. It is opt-in like every other
acceptance run; CI still runs vitest. The first-run wizard is split one module per
screen (`src/app/setup/`), and each screen can be mounted on its own; its screen
_list_ is still an open question. See the
[project status](https://github.com/eugene-plexus/specs#current-status) and the
[M9 acceptance record](https://github.com/eugene-plexus/specs/blob/main/docs/acceptance/m9-onboarding-run.md).

## Pages

- **Playground** (`/`) — pick a model from `GET /v1/models` and talk to it through
  `POST /v1/chat/completions`. Both are the gateway's OpenAI-compatible surface, unmodified: the
  playground deliberately uses no private path, because an endpoint only a first-party client can
  drive is not compatible with anything. A bar under the transcript reports which driver, runtime
  and backend served the turn, how long it took, and how many backends were tried — `attempts > 1`
  is the visible evidence the failover cascade fired.
- **Runtimes** (`/runtimes`) — the engine processes the agent supervises (`GET /v1/runtimes`)
  plus which engine adapters found a usable binary on this host (`GET /v1/engines`). Start / stop /
  restart per runtime, the resolved context length and slot count read back from the running
  engine, and the exact argv it was spawned with. `loading` is shown distinctly from `starting`,
  because a large quant off a slow disk sits there for minutes and that is not a fault.
- **Library** (`/library`) - scanned GGUF and safetensors models, model details,
  named launch profiles, and launch through the agent.
- **Discover** (`/discover`) - catalogue search, model cards, download candidates,
  quant guidance against detected hardware, and resumable download progress.
- **Config** (`/config`) — reads `/v1/config/schema` from the selected component and renders a
  typed form. Component addresses come from agent topology. Driven by schema metadata, which is the
  point — a component that adds a knob gets a form field for free. PATCHes the diff back, surfaces
  `applied` / `rejected` / `requiresRestart`, and offers a Restart Now modal that polls `/healthz`
  until the component is back.
- **Metrics** (`/metrics`) — what the gateway kept: per-request and per-attempt rows, latency and
  throughput by backend, and the tier each request was served from. Operator-only, and deliberately
  two rows per request rather than one, because a request total includes the attempts that failed.
- **Nodes** (`/nodes`) — every machine in the install, its address, and whether the control root
  can reach it. Mints a single-use join token and renders the exact `eugene-plexus-agent join`
  command to paste on the machine being added. The _other_ machine answers on its own terminal,
  because you cannot reach a worker's web UI until it advertises a non-loopback address, and
  setting that is part of what joining does.
- **First-run wizard** (`/setup`) — eight screens: theme/font, passphrase + security mode, welcome,
  deployment topology, gateway address, model directories, one external backend, summary. Split one
  module per screen under `src/app/setup/`, so a screen can be mounted and tested on its own.
  Auto-saves to sessionStorage; commits to the install on Start as a single transaction — which
  now includes enrolling this host's own agent with the control root it just spawned.
- **Same-origin proxy** at `/api/proxy/<target>/<...path>` — the browser only talks to the Next.js
  server; the server forwards to the component URL. `gateway` and `agent` are bootstrap targets;
  `library`, `control`, and named inference-drivers resolve through agent topology at
  request time. No CORS configuration on the components, no private URLs in the browser.

## Remaining Gaps

- **Token-by-token streaming.** The gateway ships correct OpenAI framing with a single content
  chunk; real pass-through needs the driver's SSE plumbed through the failover cascade. The
  playground would render the same text at the same moment either way, so it doesn't stream.
- **Control-root workflows:** enrollment, rotation, promotion and topology management
  need dedicated screens; generated types and a proxy target are not those screens.
- **Structured model slots:** `model_slots` currently renders as a JSON editor.
- **Runtime-name selection:** the driver's `runtime_name` field remains free text.
- **Creating topology entries.** The config editor and wizard configure components that already
  exist; adding one still means `POST /v1/components` or editing `agent.yaml`.

## Running

```bash
npm install
npm run codegen       # produces src/generated/*.ts from pinned specs
npm run dev
```

By default the UI is served at `http://localhost:3000` and proxies API calls to
`http://127.0.0.1:8080` (gateway) and `http://127.0.0.1:8079` (agent). Override the bootstrap
targets via env:

```bash
GATEWAY_URL=http://gateway.tailnet:8080 AGENT_URL=http://agent.tailnet:8079 npm run dev
```

Library, control-root and driver URLs are not configured here. The proxy resolves them against agent
topology at request time, which is also where the gateway reads it from — one place a driver's URL
is written down, so the UI and the router cannot disagree about where it is.

## Codegen

TypeScript types are generated from the pinned commit of `eugene-plexus/specs` recorded in [`SPECS_REF`](SPECS_REF):

```bash
npm run codegen
```

The script downloads specs at the pinned SHA and runs `openapi-typescript` for
`agent`, `control`, `gateway`, `inference-driver`, and `library`. Generated files
(`src/generated/*.ts`) are committed; CI re-runs codegen and fails on diff.
When introducing a spec document, update the codegen input list with the pin:
a newer `SPECS_REF` alone does not cause a new document to be generated.

## Development

```bash
npm install

npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format:check  # Prettier
npm run build         # Next.js production build
npm run codegen       # Regenerate from pinned specs
```

## License

Apache 2.0 — see [`LICENSE`](LICENSE).
