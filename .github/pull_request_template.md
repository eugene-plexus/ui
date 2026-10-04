<!-- Thanks for contributing to Eugene Plexus / ui! -->

## Summary

<!-- One or two sentences describing what changes and why. -->

## Type of change

- [ ] New page / panel / visualization
- [ ] Visualization improvement
- [ ] Streaming / API client work
- [ ] Refactor / cleanup
- [ ] Tooling / CI / docs
- [ ] Bump SPECS_REF (regenerated TS types included)

## Checklist

- [ ] Every commit is signed off (`git commit -s`, or `git rebase --signoff main` for an existing branch). CI will block PRs without DCO sign-offs — see [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] `npm run lint` passes (`--max-warnings=0`)
- [ ] `npm run format:check` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] If `SPECS_REF` changed, `npm run codegen` was run and the regenerated `src/generated/` is included in this PR.
- [ ] If wire contract changed, the matching PR landed in `eugene-plexus/specs` first and `SPECS_REF` is bumped here.
