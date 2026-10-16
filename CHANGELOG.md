# Changelog

## 0.2.0 (2026-10-16)

- Handoff: `pack-kb.mjs` packs the knowledge base into a zip with `BUILD.md`, a build brief for any coding agent. It checks the KB first, leaves out `sandbox/` and `log/` unless `--full`, and needs no dependencies.
- The skill ends a study by sending the zip to the user in the chat.

## 0.1.0 (2026-10-16)

First public release.

- `reverse-engineering-saas` skill: phases from charter to close, environment levels L1 to L4, action classes A0 to A5, write gate, hidden writes, change ledger, teardown and incident procedures.
- Production barriers: permissioned integrations, regulation and licensing, certifications, distribution gatekeepers, moats, intellectual property, operating cost, recorded as `BR-###` with severity and evidence.
- Knowledge base templates and `init-kb.mjs`; `check-kb.mjs` for IDs, references, evidence, ledger, evidence index and status.
- Page scripts: `inventory.js`, `tokens.js`, `api-shapes.js`, `mask.js`, `annotate.js`.
- Page scripts return structure, counts and shapes; values that look like personal data are dropped or templated, with leak tests on a fake page.
- `init-kb.mjs` defaults to `./re-<product>` and creates the KB repository even when git has no identity.
- `check-kb.mjs` flags features without a coverage row and fails `--closing` on an unfilled charter.
- Scenario test protocol (`docs/testing.md`) and automated tests for the scripts, run on Node.js 22 and 24 in CI.
- Security policy, issue templates (bug report, study report), FAQ and documentation index.
