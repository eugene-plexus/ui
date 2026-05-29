# Contributing to Eugene Plexus `ui`

Thanks for your interest. This is the web UI for Eugene Plexus — please read this before opening a PR.

## Developer Certificate of Origin (DCO)

We use the [DCO](https://developercertificate.org/) instead of a CLA. **Every commit must be signed off** with `git commit -s`:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must match your `git config user.name` and `git config user.email`. CI blocks PRs whose commits are missing matching sign-offs.

If you forgot:

```bash
git commit --amend -s --no-edit       # most recent
git rebase --signoff main             # whole branch
```

## Wire contract changes go in `specs`, not here

The UI's TypeScript types are generated from [`eugene-plexus/specs`](https://github.com/eugene-plexus/specs). If your change requires a wire-shape edit, land that PR in `specs` first; bump `SPECS_REF` here and re-run `npm run codegen` in a follow-up.

PRs to this repo should generally cover one or more of:

- **New UI surface** — pages, panels, visualizations
- **Visualization improvements** — better hemisphere display, NT state panel, etc.
- **Streaming** — once orchestrator's `/v1/chat/stream` is wired
- **Tooling** — CI, codegen, lint config

## Local setup

```bash
git clone https://github.com/eugene-plexus/ui
cd ui
npm install
npm run codegen
npm run dev
```

Plus an orchestrator running locally (or env-var-pointed at a remote one) — see the [orchestrator repo](https://github.com/eugene-plexus/orchestrator).

## Git hooks

We use [pre-commit](https://pre-commit.com/) to auto-format staged files with Prettier before they reach CI. Enable it once per clone (requires Python):

```bash
pip install pre-commit
pre-commit install
```

After that, `git commit` runs Prettier on staged files; if it reformats anything, re-stage and commit again.

## Style

- **Next.js 15+ App Router** with TypeScript strict mode
- **ESLint** with `next/core-web-vitals` + `next/typescript`
- **Prettier** with `prettier-plugin-tailwindcss`
- **Tailwind v4** for styling — utility classes, no custom CSS unless needed
- **No comments explaining what code does** — let names work. Reserve comments for _why_.

## Running checks

```bash
npm run lint          # ESLint, --max-warnings=0
npm run typecheck     # tsc --noEmit
npm run format:check  # Prettier
npm run build         # Next.js production build
npm run codegen       # Regenerate from pinned specs
```

CI runs all of these on every PR.

## Reporting issues

File issues at <https://github.com/eugene-plexus/ui/issues>.
