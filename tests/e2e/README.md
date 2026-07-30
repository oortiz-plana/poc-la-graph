# End-to-end tests

## Deterministic synthetic suite

The default Playwright suite targets the synthetic Docker Compose deployment at
`http://127.0.0.1:3000`. It verifies question submission, the Vercel AI SDK
stream frame ordering, Graphify tool activity, grounded completion, citations,
textual graph evidence, browser-session history, and confirmed reset. Its
assertions use committed synthetic graph facts, never real-provider prose.

Run it after the synthetic Compose stack is healthy:

```bash
npm ci
npx playwright install chromium
npm run test:synthetic
```

Set `E2E_BASE_URL` to test another web origin.

## Synthetic dependency recovery

The Graphify stop/restart test changes Compose state and is skipped by default.
Run it only against an expendable local POC deployment:

```bash
npm run test:recovery
```

It uses `docker-compose.yml,docker-compose.synthetic.yml` by default. Override
the comma-separated `E2E_COMPOSE_FILES` only when the target stack was launched
with a different Compose file set. The cleanup hook always brings `graphify`,
`api`, and `web` back up.

## Real Spanish Graphify smoke

The Spanish spec is deliberately excluded from `npm test`. It requires a real,
successfully ingested four-law Graphify project and configured model provider:

```bash
npm run test:spanish
```

This smoke test validates Spanish language markers, citations, graph evidence,
and source provenance without asserting exact real-LLM wording. It must not be
used as evidence that ingestion succeeded unless the real stack was prepared
and the test actually passed.

Playwright retains traces, screenshots, and video only for failed tests. Use
`npm run test:list` to discover all synthetic, recovery, and real Spanish specs
without running the stack.
