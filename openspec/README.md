# OpenSpec

OpenSpec controls significant changes to the CLENQO platform before implementation
(`PROJECT_RULES.md` §31, `README.md` §8, `ROADMAP.md` §77).

## Structure

```text
openspec/
├── README.md                  ← this file (conventions)
├── changes/                   ← active change proposals
│   └── <change-id>/
│       ├── proposal.md        ← why, what changes, impact
│       ├── specs/             ← requirements + scenarios (the contract)
│       └── design.md          ← implementation considerations, affected areas
├── specs/                     ← (future) current capabilities, updated on archive
└── archive/                   ← (future) completed changes
```

## Rules

* Changes are derived from `docs/` source-of-truth documents; contradictions are
  surfaced, not silently resolved.
* No implementation code or migrations are created until a change is approved.
* Requirements use `### Requirement:` / `#### Scenario:` blocks
  (WHEN / THEN) so they are directly testable.
* On completion, a change moves to `archive/` and affected capability specs are
  updated.
