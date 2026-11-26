# NEXUS LINK

Private WebSocket relay for one NEXUS CLOUD owner/device setup.

## Routes
- GET /health — public service health only.
- GET /connect?role=device&device=DEVICE_ID — authenticated device WebSocket.
- GET /connect?role=panel&device=DEVICE_ID — authenticated panel/server WebSocket.

## Required Worker secrets
Set these independently with Wrangler:
- NEXUS_DEVICE_TOKEN
- NEXUS_PANEL_TOKEN

Use long random values. Never commit them to GitHub or put the panel token in browser code.

## Deploy from Termux
From this folder:
```sh
npx wrangler@latest login
npx wrangler@latest secret put NEXUS_DEVICE_TOKEN
npx wrangler@latest secret put NEXUS_PANEL_TOKEN
npx wrangler@latest deploy
```

This relay only forwards a small allowlist of JSON message types. It does not execute shell commands.
The current NEXUS ENGINE does not yet include the outbound WebSocket agent, and the website does not yet include a server-side panel connector. Those are separate integration steps.
