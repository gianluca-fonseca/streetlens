# BGSD project configuration — StreetLens

conductor:
  name: Kiwi
  emoji: 🥝

## Commit conventions (standing, all sessions)

- **Author:** every commit in this repository is authored as **Gianluca Fonseca** `<76885401+gianluca-fonseca@users.noreply.github.com>` — he is the project owner and commissioning author. The repo-local git identity is already set accordingly; agents and sessions must NOT override it.
- **AI disclosure:** every AI-written commit ends with a blank line and `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (or the acting model). This trailer is permanent and non-negotiable — it is what keeps the history honest and defensible.
- **Granularity:** atomic commits with explicit pathspecs, committed as work progresses. Never `git add -A`.
- Pipeline worktrees follow the naming `streetlens-wt-<unit>` and are removed via `git worktree remove` + `prune` when merged and no longer live.

## Branch protection

- `main` is never written by BGSD or agents; `next` is the standing rehearsal branch; `next → main` lands only through a PR merged by a human.
