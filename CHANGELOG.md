# Changelog

## 0.3.0 (2026-10-16)

Fixes for the gaps found by the first real study (Pipedrive, L3, `examples/pipedrive/`).

- Handoff: `pack-kb.mjs` keeps `sandbox/ledger.csv` in the zip with object IDs and locations blanked and URLs replaced by `[url]`. An unzipped handoff now passes `check-kb --closing`, and `L-###` references in the KB resolve.
- Baseline counts cover only the container and the operator's records since the first ledger row, by filter or count endpoint, never by pulling full record lists. Teardown compares those counts. `environment.md` records the filter.
- L3: when the container cannot be private, set each record's visibility to the operator only. An unattended session that starts during the team's working hours writes only when the team cannot see the records; otherwise it does the phases without writes first.
- "Stop and skip": deleting your own ledger items inside the sandbox is exempt from the "cannot be undone" stop when the dialog names only those items.
- `mask.js`: selectors become CSS rules that also blur elements rendered later (popovers, dropdowns), until `clear()`. Placeholders that match a pattern are blurred, and `placeholders: true` blurs all of them. Invalid selectors are reported. New "Masking" section in `extraction.md`.
- `tools.md`: Claude in Chrome notes. Long `javascript_tool` results are read through an offscreen `<article>` and `get_page_text`. Use `api-shapes.js` when `read_network_requests` misses app calls. Never load scripts from a local server in the user's tab. Check state after each click in a background window. Where `save_to_disk` screenshots land.

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
