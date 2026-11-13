# @kedalion/view-browser

Browser

- Id: `browser`.
- `src/server.ts`: server entry (`browserServerView`; routes, socket, `browser` settings group).
- `src/server/service.ts`: the browser service (launches Edge/Chrome through `@kedalion/cdp`, tabs, logs, screencast).
- `src/protocol.ts`: socket messages shared with the web half; `src/address.ts`: URL bar text to URL.

Settings: `browser` group (`executable`, `ignoreLocalCertErrors`, `hideAutomation`, `agentTools`, `home`).
