/** Sent to every MCP client in the `initialize` reply: what this browser is and how to test a web app with it. */
export const MCP_INSTRUCTIONS = `This is Kedalion's own browser: a real Chromium the user sees in the Browser view of the Kedalion app, with its own persistent profile (logins and cookies survive restarts). Use it to open, test and debug the web app the user points you at (localhost or any URL) instead of guessing from the code.

Workflow
- browser_open <url> (newTab to keep the current one) -> browser_snapshot (title, headings, form fields with selectors, links, text) -> browser_click / browser_type / browser_wait_for -> check the result with browser_snapshot or browser_screenshot.
- Every tool takes an optional tab id (browser_tabs lists them); the default is the active tab. The user sees what you do, live.
- Local dev servers with self-signed certificates on localhost work when the user's setting allows it.

Driving pages (also SmartGWT-style pages with id-less td/div buttons)
- browser_snapshot lists Clickable elements with refs (e1..); scope (selector or container text), section, limit/offset narrow and page it. Refs stay valid until the next snapshot or navigation.
- browser_click takes text (visible text, exact match preferred), ref, selector, target or x/y; browser_type/browser_fill take label (label, placeholder, aria-label or preceding text), ref, selector or target (browser_type's text is the content, browser_fill's is value). An ambiguous match is an error listing candidates with refs.
- Actions scroll the target into view and wait (timeoutMs, default 5000) until it is visible, uncovered and still; the error names what covers it (e.g. a Loading overlay: use browser_wait_for gone=true or idle=true first). They return the effect: focus and value, appeared/disappeared text, requests started, new console errors.
- browser_select {label|ref, option} picks from native and custom dropdowns; browser_expand {text|ref} opens a tree node; browser_target {action: set|list|remove, name, text|selector|label} saves names per site, usable as target=<name>.

Debugging
- browser_console (level, text, since) and browser_network (url, status, failedOnly) show what the page logged and requested; browser_network_detail gives headers and bodies of one request by id. Logs reset on navigation unless browser_preserve_logs on; with it on, request and response bodies recorded as requests finished (up to 512 KB each) stay readable by browser_network_detail after navigations.
- RPC apps (SmartGWT IDACall): browser_network rows show the decoded operations ("IDACall: Interface.method +14"); browser_network body=<text> searches decoded request bodies and recorded responses, sinceMark=<name> (set with browser_network_mark) lists only later requests, pendingOver=<ms> lists stuck requests with their age. browser_network_detail shows the decoded request body and operation list (decoded=false for raw) and slices the response with bodyOffset/bodyLimit or grep=<text> (matching lines, 2 lines context).
- Every browser tool call is recorded: browser_steps (limit, clear) lists them; browser_steps_mark <name> starts a named run, browser_steps_diff a b compares two runs, browser_steps_export (json|md, path?) saves them to Downloads.
- browser_eval runs JavaScript in the page. browser_breakpoint_* and browser_debugger_* pause and step the page's JavaScript; browser_trace_start/stop records a performance trace.

Clean state for a test
- browser_cookies lists cookies; browser_cookies_clear removes one, those of the page or all of the browser; browser_cookie_set creates one.
- browser_storage lists localStorage, sessionStorage and IndexedDB; browser_storage_set and browser_storage_clear change them. browser_storage_clear kind=site wipes everything of the origin (cookies, storage, caches, service workers), then reload.

Simulating conditions
- browser_intercept blocks a URL pattern or answers it with a fixed response (error states, empty lists) for every tab; remove the rules when done.
- browser_emulate switches the tab to a phone, tablet or custom size, with user agent, locale and timezone. reset restores it.
- browser_export_har saves the network log to Downloads.

Rules: do not use the user's other browser; clean up what you changed (rules, emulation) unless asked to keep it; output is capped, so narrow queries (limit, text, selector) instead of asking for everything.`;
