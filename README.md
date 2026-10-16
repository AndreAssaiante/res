# RES: Reverse Engineering SaaS

An agent skill for studying a SaaS web product (ClickUp, Pipedrive, any web app) through the browser and turning it into a knowledge base your team can use to rebuild the product and take it to production.

The agent explores the product in a test environment, records every change it makes, writes what it learns to files with evidence for each statement, and lists what could stop the clone from launching.

## What you get

One folder per product, `re-<product>/`:

| Area | Content |
|---|---|
| Inventory | Feature tree, screen catalog with URL patterns, a coverage matrix that works as the queue |
| UX | One file per screen and per component: anatomy, states, interactions, keyboard, accessibility, microcopy |
| Behavior | Business rules as Given/When/Then with evidence, user flows, cross-cutting topics |
| Data | Entities with fields, enums and relations, ER diagram, TypeScript types, permissions matrix, API endpoint shapes |
| Design | Tokens for color, type, spacing, radius, shadow and motion, mapped to the product's CSS variables |
| Production barriers | Integrations that need approval, licenses, certifications, distribution gatekeepers and moats, with severity, lead time and mitigation |
| Clone | Requirements (PRD), parity tests derived from the rules, what to copy, avoid and improve |
| Safety | Environment description, preflight results, change ledger, fixtures |
| Continuity | `STATUS.md`, one log per session, evidence files with dates |

## Quickstart

**1. Install.** In Claude Code:

```bash
claude plugin marketplace add alextnetto/res
```

```bash
claude plugin install res@res
```

For other agents that read skills from disk, copy the skill folder into the agent's skills directory (`~/.claude/skills/` for Claude Code, `~/.agents/skills/` for most others):

```bash
git clone https://github.com/alextnetto/res.git && cp -R res/skills/reverse-engineering-saas ~/.claude/skills/
```

You also need Node.js 20 or later and an agent that can drive a browser: Claude in Chrome, Playwright MCP or Chrome DevTools MCP.

**2. Prepare a safe environment (recommended).** Create a trial account of the product with an email you own, log in to it in a separate Chrome profile, and point the agent at that profile. Without it, the agent creates a separate workspace or a sandbox container, or only observes.

**3. Ask.** In plain language, in any language:

- "Study Pipedrive so my team can rebuild it for the Brazilian market. Use the trial profile."
- "Reverse engineer ClickUp's board and task view. Create a test environment, don't ask me anything."
- "Continue the ClickUp study." The agent resumes from `STATUS.md`.

The agent creates the knowledge base with `init-kb.mjs`, works through the phases below, and runs `check-kb.mjs` before it stops.

## How it works

| Phase | What happens |
|---|---|
| 1 Charter | Goal, scope, priorities and the clone's target market |
| 2 Environment | Pick the safest environment; run a preflight for automations, webhooks and integrations that could fire |
| 3 Recon | Public docs, API reference, pricing, integrations list and terms, read with web fetch; first barrier scan |
| 4 Map | Every screen and route; stack and design tokens |
| 5 Deep dive | One feature at a time: fixtures, states, rules, persistence, network, written to disk before the next feature |
| 6 Synthesis | Data model, design tokens, barriers, PRD, parity tests |
| 7 Close | Restore what changed, update `STATUS.md`, pass `check-kb` |

### Safety model

| Level | Environment | What the agent may change |
|---|---|---|
| L1 | Trial account in a separate browser profile, created by you | Everything except outbound actions |
| L2 | New, empty workspace under your login | Test data and configuration inside that workspace |
| L3 | One sandbox list, project or pipeline inside production | Test data inside the container only |
| L4 | Production, observe only | Nothing |

At every level the agent never sends messages or invites, never assigns or mentions other people, never touches billing, never creates accounts and never types passwords. It treats autosave, read receipts and persistent view changes as writes. Every change goes to `sandbox/ledger.csv` and is restored or removed at the end. When you ask it not to interrupt you, it writes what needs you under "Needs human" in `STATUS.md` and keeps working on the rest.

### What the entries look like

A rule:

```markdown
### R-014 Completing the last open activity prompts for the next one
- Given a deal with exactly one open activity
- When the user marks that activity done
- Then a "Schedule next activity" dialog opens; Cancel closes it and the deal shows a warning icon
- Evidence: [obs EV-031, EV-032]
```

A production barrier:

```markdown
### BR-003 WhatsApp messages need Meta business verification
- Category: permissioned integration
- Blocks: F-014 (WhatsApp notifications)
- Severity: blocks feature
- Mitigation: start verification in month one; launch with email notifications
- Evidence: [doc SRC-021]
```

`[obs ...]` is something the agent saw, `[net ...]` a network capture, `[doc ...]` public documentation, `[inf]` an inference with an open question.

## Status

Version 0.1.0. The method was tested with scenario runs on subagents, before and after writing the skill, and the scripts with automated tests. It has not yet been run end to end on a real product, so expect rough edges in the first studies. Reports from real runs are welcome.

How RES compares with [REA](https://github.com/morluto/rea), a technical reverse engineering tool: [docs/comparison-with-rea.md](docs/comparison-with-rea.md).

## Repository layout

```
skills/reverse-engineering-saas/
  SKILL.md               Rules and workflow (what the agent reads first)
  references/            Safety, exploration method, barriers, KB format, extraction, browser tools
  templates/             Knowledge base scaffold and artifact templates
  scripts/init-kb.mjs    Creates a knowledge base
  scripts/check-kb.mjs   Validates IDs, references, evidence, ledger and status
  scripts/page/          Browser scripts: inventory, tokens, api-shapes, mask, annotate
docs/                    Design decisions, test protocol, comparison with REA
tests/                   Automated tests for the scripts
```

## Responsible use

Use RES only on accounts you own or are authorized to examine. Read the product's terms: many forbid reverse engineering or competing use, and that decision is yours. Rebuild from observed behavior; do not copy code, icons, illustrations, logos or long text. The barrier analysis is research, not legal advice.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run the tests with `npm install` and `npm test`.

## License

[MIT](LICENSE)
