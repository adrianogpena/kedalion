/** Sent to every MCP client in the `initialize` reply: what this browser is and how to test a web app with it. */
export const MCP_INSTRUCTIONS = `This is Kedalion's own browser: a real Chromium the user sees in the Browser view of the Kedalion app, with its own persistent profile (logins and cookies survive restarts). Use it to open, test and debug the web app the user points you at (localhost or any URL) instead of guessing from the code.

Workflow
- browser_open <url> (newTab to keep the current one) -> browser_snapshot (title, headings, form fields with selectors, links, text) -> browser_click / browser_type / browser_wait_for -> check the result with browser_snapshot or browser_screenshot.
- Every tool takes an optional tab id (browser_tabs lists them); the default is the active tab. The user sees what you do, live.
- Local dev servers with self-signed certificates on localhost work when the user's setting allows it.

Debugging
- browser_console (level, text, since) and browser_network (url, status, failedOnly) show what the page logged and requested; browser_network_detail gives headers and bodies of one request by id. Logs reset on navigation unless browser_preserve_logs on.
- browser_eval runs JavaScript in the page. browser_breakpoint_* and browser_debugger_* pause and step the page's JavaScript; browser_trace_start/stop records a performance trace.

Clean state for a test
- browser_cookies lists cookies; browser_cookies_clear removes one, those of the page or all of the browser; browser_cookie_set creates one.
- browser_storage lists localStorage, sessionStorage and IndexedDB; browser_storage_set and browser_storage_clear change them. browser_storage_clear kind=site wipes everything of the origin (cookies, storage, caches, service workers), then reload.

Simulating conditions
- browser_intercept blocks a URL pattern or answers it with a fixed response (error states, empty lists) for every tab; remove the rules when done.
- browser_emulate switches the tab to a phone, tablet or custom size, with user agent, locale and timezone. reset restores it.
- browser_export_har saves the network log to Downloads.

Rules: do not use the user's other browser; clean up what you changed (rules, emulation) unless asked to keep it; output is capped, so narrow queries (limit, text, selector) instead of asking for everything.`;
