# Synthetic multi-turn persistence check

This black-box check uses the API at `127.0.0.1:8000` and the explicit
base-plus-synthetic Compose project. It creates one conversation, validates two
ordered SSE responses (including a referential Spanish follow-up), restarts only
the API service, and verifies that the four messages and their normalized
results remain in the named persistent knowledge volume.

Run only against the synthetic POC stack:

```bash
python3 tests/e2e/multiturn/verify_persistence.py
```

The script intentionally leaves the verified conversation available for
inspection.

`E2E_FIRST_QUESTION` and `E2E_FOLLOW_UP_QUESTION` can select questions suitable
for a real mounted knowledge graph. Set `E2E_ALLOW_INSUFFICIENT=true` for a
real smoke test where a grounded insufficient-evidence result is acceptable.

To run the same check through PostgreSQL after starting the PostgreSQL overlay:

```bash
E2E_COMPOSE_FILES=docker-compose.yml:docker-compose.synthetic.yml:compose/postgres.yml \
  python3 tests/e2e/multiturn/verify_persistence.py
```
