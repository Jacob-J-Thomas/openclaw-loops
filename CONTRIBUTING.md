# Contributing

Use Node 24.16.0 or supported Node 26 and the exact OpenClaw peer version in package.json. Run `npm ci`, then `npm run check`. `node scripts/verify-package.mjs` verifies the extracted archive against the actual feature SDK with fake model transport. It does not replace live acceptance.

Keep `.dev-profile` private. Never commit credentials, personal history, model files or host state. Use dedicated synthetic chats for live evidence. Do not modify a personal assistant or EmbodySense project as part of this plugin.

Preserve public SDK APIs and host authority. Version semantic changes, test regressions and document migration/rollback. Execution adapters must explain side effects, permission, cancellation and uncertain outcomes. Full agent lifecycle control is required; actual human review stays explicit.

Build/test success, verified local installation, upstream availability and public marketplace release are separate gates. Track evidence in the delivery status.
