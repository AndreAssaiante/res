# Safety procedures

SKILL.md holds the rules (levels, action classes, write gate, stop list). This file holds the procedures.

## Setting up each level

### L1 Dedicated account (best)

The user does these steps; the agent writes them under "Needs human" in `STATUS.md` when they are missing.

1. Sign up for a trial or sandbox with an address the user owns (for example `name+re-product@domain`). Some products sell sandbox accounts on higher plans (Pipedrive, Salesforce, HubSpot); prefer them when available.
2. Create a separate browser profile used only for this study, and log in there. The production account must not be logged in on that profile.
3. Connect the agent's browser tool to that profile (see `tools.md`).
4. Record in `environment.md`: account email, workspace name, plan, trial end date, profile name.

A separate profile is the strongest guard: the agent cannot reach production even by mistake.

Note the trial end date. Plan-gated features must be studied before it.

### L2 Separate workspace

1. Confirm creation is free: no payment form, no plan choice that starts billing, no terms to accept. If any appears, cancel and fall back to L3.
2. Name it `🧪 [RE] <Product> study`.
3. Do not invite anyone.
4. Record its name, URL and ID.

The user's personal settings (profile, notification preferences, theme) are shared across workspaces. A3 rules still apply.

### L3 Sandbox container

1. Pick the most private place the product offers: a personal space, a private project, a pipeline restricted to the operator.
2. Name it `🧪 [RE] Sandbox`.
3. Record the full breadcrumb, URL and ID. The write gate compares the screen against this.
4. Inherited configuration (statuses, tags, custom fields defined above the container) is read-only. Create new fields at container level only, and only when the product offers that scope explicitly.
5. Note who can see the container. A pipeline or project visible to the whole company is acceptable only with fake data and the `[RE]` prefix.

### L4 Observe only

A0 and A1 only. Use L4 for production screens that cannot be reproduced in the sandbox (real volume, real configuration). Mask personal data before every screenshot.

## Preflight checklist

Run before the first write at L2 or L3. Record each answer in `environment.md`.

| Check | Where to look | Write allowed if |
|---|---|---|
| Members | Workspace members or users page | At L3: count noted; nobody will be assigned or mentioned |
| Automations | Automations, workflows, rules pages; container-level automations | None active that triggers on records in the write scope |
| Webhooks and API apps | Developer, webhooks, apps or marketplace pages | None that would receive events from the write scope, or the user confirms they are harmless |
| Integrations | Slack, Teams, email, calendar, Zapier, Make | None posting from the write scope |
| Email and calendar sync | Personal and company sync settings | Off, or the records created have no attendees or recipients |
| Plan and trial | Billing page (read only) | Plan known; trial end date noted |
| Baseline counts | List views with counters, or a configured API connector (GET only) | Counts recorded for comparison at close |

If an automation would fire on sandbox records, choose another container or stay at L4 for that feature.

## Ledger

`sandbox/ledger.csv`, one row per change. Columns:

| Column | Content |
|---|---|
| `id` | `L-001`, sequential |
| `time` | ISO timestamp |
| `class` | A1, A2, A3, A4, or `incident` |
| `action` | `create`, `update`, `delete`, `toggle`, `incident` |
| `object` | Type and name, for example `task "[RE] overdue"` |
| `location` | Breadcrumb or URL |
| `object_id` | Product ID when known |
| `before` | Previous value for updates and A3 changes; empty for creates |
| `undo` | How to reverse it |
| `status` | `open`, `restored`, `removed`, `kept` |
| `note` | Required for `kept` and `incident` |

Rules:

- Write the row before the action, or immediately after if the ID only exists after creation.
- One row can cover a batch of identical fixtures (`object` = `12 tasks "[RE] f-01..f-12"`).
- A1 changes need a row only when they risk persisting (view drafts, filters on a saved view).
- `kept` means the user decided to keep it, or it stays for the next session as a fixture. State which in `note`.

## Teardown

At the end of each session: restore every A1 and A3 row. At the end of the study: remove every A2 and A4 row.

1. Work from the ledger, newest first, so dependents go before their parents.
2. Delete through the product's own controls. Prefer deleting the container when everything inside it belongs to the study.
3. Verify each removal: reload, search for the `[RE]` prefix, check trash or "restore data" pages.
4. Look for orphans. Deleting a parent can leave children behind (activities, notes, comments, attachments, time entries). Search for them by the `[RE]` prefix and by date.
5. Compare the baseline counts with the current counts. Explain every difference.
6. List residuals in `STATUS.md` (for example "note 2034 attached to a deleted deal; no UI to delete it").
7. Run `check-kb --closing`. It fails while any ledger row is `open`.

Trash retention (often 30 days) means a removed item is still restorable. State this in `STATUS.md`.

## Incidents

When something goes wrong:

1. Undo at once if an undo control is visible (toast, Ctrl+Z, "restore").
2. Add a ledger row with class `incident`: what happened, who could have seen it, what was undone, what remains.
3. If a real person may have been notified, add it under "Needs human" in `STATUS.md` with the exact wording the user can send them.
4. Do not hide or minimize it in the session log.

## Hidden writes: examples

| Pattern | Seen in |
|---|---|
| View changes are drafts until "Save view"; the draft is lost on reload | ClickUp |
| A layout toggle in a task changes the user's global preference | ClickUp |
| Completing the last open activity opens a "schedule next activity" dialog | Pipedrive |
| Deleting deals leaves their activities in place | Pipedrive |
| Notes attached to deleted records become unreachable in the UI | Pipedrive |
| Inline fields save on blur, with no Save button | Most products |
| Opening the inbox marks notifications as read | Most products |

Add new patterns to `topics/hidden-writes.md` in the KB when found.
