# Eugene Plexus — `ui`

[![CI](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org)

Web UI for [Eugene Plexus](https://github.com/eugene-plexus): a dashboard for the engine
processes the supervisor runs, a schema-driven config editor for every component, and a chat
playground over the gateway's OpenAI-compatible endpoint.

## Status

**M0 of the local-inference control plane.** Runtime dashboard, config editor and playground are
wired to the real contracts. The first-run wizard is a cut-down version of the old ten-screen flow,
not the rewrite — that needs engine acquisition and the model library to exist, and lands at M6.

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
- **Config** (`/config`) — reads `/v1/config/schema` from the selected component and renders a
  typed form for every field. Tabs are the agent, the gateway, and one per inference-driver in
  the agent topology. Driven entirely by schema metadata; no per-component UI code, which is the
  point — a component that adds a knob gets a form field for free. PATCHes the diff back, surfaces
  `applied` / `rejected` / `requiresRestart`, and offers a Restart Now modal that polls `/healthz`
  until the component is back.
- **First-run wizard** (`/setup`) — seven screens: theme/font, passphrase + security mode, welcome,
  deployment topology, gateway address, one driver, summary. Auto-saves to sessionStorage; commits
  to the agent on Start as a single transaction.
- **Same-origin proxy** at `/api/proxy/<target>/<...path>` — the browser only talks to the Next.js
  server; the server forwards to the component URL. `gateway` and `agent` are fixed targets;
  anything else is the name of an `inference-driver` in the agent topology, resolved there at
  request time. No CORS configuration on the components, no private URLs in the browser.

## What M0 doesn't do

- **Token-by-token streaming.** The gateway ships correct OpenAI framing with a single content
  chunk; real pass-through needs the driver's SSE plumbed through the failover cascade. The
  playground would render the same text at the same moment either way, so it doesn't stream.
- **Model library / discovery / download** — M2 and M3.
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

Driver URLs are not configured here. The proxy resolves a driver name against the agent
topology at request time, which is also where the gateway reads it from — one place a driver's URL
is written down, so the UI and the router cannot disagree about where it is.

## Codegen

TypeScript types are generated from the pinned commit of `eugene-plexus/specs` recorded in [`SPECS_REF`](SPECS_REF):

```bash
npm run codegen
```

The script downloads specs at the pinned SHA and runs `openapi-typescript`. Generated files (`src/generated/*.ts`) are committed for reproducibility; CI re-runs codegen and fails on diff.

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
