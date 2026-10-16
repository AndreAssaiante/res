# Browser tools

The skill needs six capabilities: navigate and act, screenshot to a file, read the accessibility tree, run JavaScript in the page, read network requests, and resize the window. Use the tool that reaches the right browser profile.

| Capability | Claude in Chrome (`mcp__claude-in-chrome__*`) | Playwright MCP (`browser_*`) | Chrome DevTools MCP | Computer use |
|---|---|---|---|---|
| Uses the user's logins | Yes, the profile where the extension runs | Only its own profile, after the user logs in there | Yes, if attached to the user's Chrome | Yes, whatever is on screen |
| Act | `computer`, `form_input`, `navigate` | `browser_click`, `browser_type`, `browser_navigate` | `click`, `fill`, `navigate_page` | Clicks and keys |
| Screenshot to file | `computer` screenshot with `save_to_disk: true`, then copy the returned path to `evidence/` | `browser_take_screenshot` with `filename` | `take_screenshot` with a file path | Screenshot, then save |
| Accessibility tree | `read_page` | `browser_snapshot` | `take_snapshot` | No |
| JavaScript | `javascript_tool` | `browser_evaluate`, `browser_run_code_unsafe` | `evaluate_script` | No |
| Network list | `read_network_requests` | `browser_network_requests` | `list_network_requests` | No |
| Real drag | Limited | `browser_drag` | `drag` | Yes |

Tool names change between versions. Check the tools actually present in the session.

## Choosing

- **L1 dedicated account:** the separate profile is the guard. Use Playwright MCP with a persistent profile directory that only holds the trial login, or Claude in Chrome installed in a separate Chrome profile.
- **L2 to L4 (user's own login):** Claude in Chrome in the user's Chrome. Open a new tab for the study; do not act on the user's existing tabs.
- **Desktop apps:** limited. Computer use gives screenshots and clicks only, with no DOM or network access, so most of this skill does not apply. Prefer the product's web app.
- **Built-in app browsers** (for example the Claude desktop browser pane) have no user logins and may ask for approval per site. Use them only for local files and public pages.

## Separate profile for L1

The user does this once:

- Chrome: Profile menu → Add → name it `RE <Product>`. Install the agent's browser extension in that profile, log in to the trial account there, and use only that window for the study.
- Playwright MCP: start it with a dedicated user data directory (for example `--user-data-dir ~/.re-profiles/<product>`), open the product, and let the user log in once. The session persists across runs.

Record the profile name in `environment.md`.

## Window size

In a dedicated profile (L1) or a browser only the agent uses, set a fixed size at the start (1440 × 900) and record it. Change it only for responsive checks, then restore it.

In the user's own Chrome, do not resize a window the user may be using (a call, other work). Record the current viewport in `environment.md` and use it for every screenshot. Responsive checks wait for a moment the user is away, or go to "Needs human".

## Public sources

Read documentation, API references, pricing and changelogs with web search and web fetch, not with the agent's browser. This keeps the logged-in browser for the product and avoids per-site approval prompts.
