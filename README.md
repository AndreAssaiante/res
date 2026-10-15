# reverse-engineering-saas

An agent skill for studying a SaaS web product (ClickUp, Pipedrive, any web app) through the browser and turning it into a knowledge base from which a team can rebuild the product.

The agent drives a browser, works in a test environment, records every change it makes in the product, and writes everything it learns to files, with evidence for each statement.

## What the agent produces

One folder per product (`re-<product>/`):

| Area | Content |
|---|---|
| Inventory | Feature tree, screen catalog with URL patterns, coverage matrix (the work queue) |
| UX | One file per screen and per component: anatomy, states, interactions, keyboard, accessibility, microcopy |
| Behavior | Business rules as Given/When/Then with evidence, user flows, cross-cutting topics |
| Data | Entities with fields, types, enums and relations; ER diagram; TypeScript types; permissions matrix; API endpoint shapes |
| Design | Design tokens: color, typography, spacing, radius, shadow, motion |
| Clone | Requirements, parity tests derived from the rules, what to copy, avoid and improve |
| Safety | Environment description, preflight results, change ledger, fixtures |
| Continuity | `STATUS.md` (where the study stands), session logs, evidence files |

## Safety model

The agent picks the safest environment available and follows a fixed table of what it may do there.

| Level | Environment | Writes allowed |
|---|---|---|
| L1 | Dedicated trial account in a separate browser profile (created by the user) | Everything except outbound actions |
| L2 | New, empty workspace under the user's login | Data and configuration inside that workspace |
| L3 | One sandbox list, project or pipeline inside production | Data inside the container only |
| L4 | Production, observe only | None |

At every level the agent never sends messages or invites, never assigns or mentions other people, never touches billing, never creates accounts and never types passwords. Every change goes into `sandbox/ledger.csv` and is restored or removed at the end. In unattended mode the agent does not ask questions: it records what needs a human in `STATUS.md` and continues with other work.

## Install

Claude Code plugin:

```bash
claude plugin marketplace add alextnetto/reverse-engineering-saas
```

```bash
claude plugin install reverse-engineering-saas@reverse-engineering-saas
```

Or copy the skill folder for any agent that reads skills from disk:

```bash
cp -R skills/reverse-engineering-saas ~/.claude/skills/
```

The skill needs Node.js 20 or later for its scripts and an agent with browser control (Claude in Chrome, Playwright MCP or Chrome DevTools MCP).

## Use

Ask the agent in plain language, for example:

- "Quero copiar o Pipedrive do zero. Cria um ambiente de teste e documenta tudo."
- "Study ClickUp's board view and task view so my team can rebuild them."
- "Continue the ClickUp study" (the agent resumes from `STATUS.md`).

For the safest run, create a trial account first, open it in a separate Chrome profile, and tell the agent to use that profile.

## Repository layout

```
skills/reverse-engineering-saas/
  SKILL.md                 Rules and workflow
  references/              Safety procedures, exploration method, KB format, extraction, tools
  templates/kb/            Knowledge base scaffold
  templates/artifacts/     Screen, component, entity, flow, rules, topic and session log templates
  scripts/init-kb.mjs      Creates a knowledge base
  scripts/check-kb.mjs     Validates IDs, references, evidence, ledger and status
  scripts/page/            Browser scripts: inventory, tokens, api-shapes, mask, annotate
docs/design.md             Design decisions and baseline test results
docs/testing.md            How the skill was tested and how to re-run the tests
tests/                     Automated tests for the scripts
```

## Tests

```bash
npm install
```

```bash
npm test
```

`docs/testing.md` describes the scenario tests run with subagents before and after writing the skill.
