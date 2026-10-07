# Contributing

Works for people and for Claude Code. Start with `CLAUDE.md` and `docs/README.md`.

## Setup

```bash
pnpm bootstrap     # install, Playwright Chromium, build everything
pnpm start         # http://localhost:3001
```

Requires Node 22 and pnpm 11 (the exact version is pinned in `package.json`).

## Workflow

1. Branch from `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Never push to `main` directly: it deploys.
2. Make the change with tests (see `docs/TESTING.md`). Bug fixes start with a failing test.
3. `/check` in Claude Code, or `pnpm build && pnpm test`.
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/), as the history already does: `feat(landing): …`, `fix: …`, `ci: …`, `chore: …`, `docs: …`.
5. Open a pull request using the template. CI must pass.
6. Squash or merge after review.

## Definition of done

- Behavior works and is covered by a test that would fail without it
- `pnpm build`, `pnpm test`, `pnpm lint` and `pnpm format:check` pass; `pnpm test:url-first` too if you touched checkers, scoring, reports or URL-first flow
- User-facing words use glossary terms and avoid the "_Avoid_" words in `CONTEXT.md`
- A decision that changes architecture, safety or product behavior has an ADR (`/adr`)
- Docs that describe what you changed are updated: `docs/API.md` for routes, `docs/CONFIGURATION.md` for settings
- `CHANGELOG.md` has a line under Unreleased
- No secrets, no generated output (`.qa-*`, `.tmp-*`, `/public`) in the diff

## Decision records

`docs/adr/NNNN-short-title.md` with `# NNNN: Title`, `## Context and Decision`, `## Consequences`. Use the next unused
number (the latest is 0018; 0013 to 0017 are unused or unwritten, so check before numbering). Superseded records
get a note at the top rather than being deleted.

## Code conventions

- TypeScript `strict`; ES modules with `.js` extensions in relative imports (NodeNext).
- Pure logic goes in `@qa/types` or `@qa/core`; the runner only wires and serves; the wizard imports only browser-safe modules.
- Wording is part of the product. Plain words on top, developer detail underneath (ADR 0010, 0018).
- Lint with `pnpm lint` (ESLint) and format with `pnpm format` (Prettier writes files; `pnpm format:check` only checks). CI runs both. Warnings are allowed, errors fail. Fix the line, or disable one rule on one line with a reason (`// eslint-disable-next-line rule -- reason`); never disable a whole file.
- `TODO` comments are written `TODO(T-nn): text`, where `T-nn` is a ticket id in `docs/tickets/INDEX.md`. No bare `TODO`. Applies to new TODOs; if no ticket fits, add one first.
- Open work is tracked in `docs/tickets/INDEX.md`. Its status column (todo, planned, approved, built, done, blocked) is the committed record and wins over `.claude/work/backlog.md`, which is git-ignored local scratch.

## License

Functional Source License 1.1 with MIT future license (`LICENSE`). By contributing you agree your contribution
is under the same terms.
