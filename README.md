# Eugene Plexus — `ui`

[![CI](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/eugene-plexus/ui/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg)](https://nextjs.org)

Web UI for [Eugene Plexus](https://github.com/eugene-plexus): chat with Eugene, watch the bicameral process unfold side-by-side, and edit any component's config from one place.

## Status

**v0.1, working chat + generic config editor + first-run wizard.** Streaming and end-to-end testing against real components are next.

## What's in v0.1

- **Chat page** (`/`) — message Eugene, see the assistant's final reply in the main column. The right rail shows every bicameral pass: each hemisphere's raw output, the corpus-callosum agreement score, and the decision (`terminate` / `another_pass` / `cap_reached`). On load, the page checks the watchdog's `firstRunComplete` flag and redirects to `/setup` if false.
- **First-run wizard** (`/setup`) — seven-screen linear flow that walks the operator through theme/font, deployment topology, orchestrator settings, both drivers (provider + credentials + model), and a final summary. Auto-saves to sessionStorage so a tab refresh doesn't lose progress; commits to the watchdog on the Start button (PATCH driver configs, flip `firstRunComplete` to true, restart components).
- **Generic config editor** (`/config`) — reads `/v1/config/schema` from the selected component (orchestrator, left driver, right driver) and renders a typed form for every field. Driven entirely by the schema metadata; no per-component code. PATCHes the diff back, surfaces `applied` / `rejected` / `requiresRestart` from the response, and offers a Restart Now modal that polls `/healthz` until the component is back.
- **Same-origin proxy** at `/api/proxy/<target>/<...path>` — the browser only talks to the Next.js server; the server forwards to the configured component URL. `orchestrator` and `watchdog` are fixed targets; any other target is treated as a driver name and resolved against the orchestrator's `drivers` list at request time. No CORS configuration on the components, no exposing private URLs to the browser.

## What v0.1 doesn't do

- Streaming (`/v1/chat/stream` is still 501 on the orchestrator; the UI calls non-streaming chat)
- NT state visualization
- Hemisphere reachability panel (server-side errors propagate; explicit panel comes when the rest of the UI surface is settled)
- Auth (per-org decision: v0.1 has none; deployment assumed behind a Tailscale tailnet)

## Running

```bash
npm install
npm run codegen       # produces src/generated/*.ts from pinned specs
npm run dev
```

By default the UI is served at `http://localhost:3000` and proxies API calls to `http://127.0.0.1:8080` (orchestrator) and `http://127.0.0.1:8079` (watchdog). Override the bootstrap targets via env:

```bash
ORCHESTRATOR_URL=http://orch.tailnet:8080 \
WATCHDOG_URL=http://watchdog.tailnet:8079 \
npm run dev
```

Driver URLs are not configured here — the proxy resolves driver names by reading the orchestrator's `drivers` list at request time, so the orchestrator is the single source of truth for topology.

> **v0.1 has no auth.** The proxy forwards anything the UI sends. Deploy behind a Tailscale tailnet or equivalent. Auth lands in v0.2.

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
