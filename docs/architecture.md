# Architecture

- lib/index.js: cordis loader entry (no server logic)
- lib/client.js: buildMessageOutline(ctx) - DOM idempotency-guarded outline rail
- Data: sessions snapshot (chat.order/chat.nodes) + official data-chat-anchor-key anchors
- Zero dependencies, zero polling, zero external services
