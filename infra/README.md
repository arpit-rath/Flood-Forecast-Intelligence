# Fixture API deployment

`template.yaml` deploys the deterministic fixture API to API Gateway and Lambda. It has no secrets and cannot write reports, reviews, or closures. Every returned dataset identifies itself as synthetic `Scenario` data. `Live` requests return 503. This template is an integration checkpoint, not the full production architecture described in `Architecture.md`.

The Lambda package contains only the Python backend modules needed by the handler and `data/fixture/scenario.json`. The staging script recreates `infra/.lambda-package/` from an explicit source allowlist; it refuses to replace that directory if unexpected files are present. Both staging and SAM build output are ignored by Git.

From the repository root, with Python 3.12 and AWS SAM CLI installed, build it with these exact commands:

```powershell
python infra/package_lambda.py
sam build --template-file infra/template.yaml
```

If SAM CLI is not on `PATH` but `uv` is available, use this exact alternative for the second command:

```powershell
uvx --python 3.12 --from aws-sam-cli==1.167.0 sam build --template-file infra/template.yaml
```

Inspect `.aws-sam/build/VarunaFixtureApi/` after building. The template keeps `backend.varuna.api.lambda_handler` and the fixture lookup at `data/fixture/scenario.json` unchanged. Building does not deploy anything.

When deployment is separately authorized, set `AllowedOrigin` to the exact frontend origin. The API URL is an output of the stack. The deployed endpoint serves `GET /v1/pilot`, `GET /v1/snapshots/current?mode=Scenario`, `POST /v1/routes/compare`, and `POST /v1/interventions/compare`. Report mutation and media upload require a later persistent, authenticated implementation; the handler returns explicit 403/501 responses rather than pretending they succeeded.

Do not commit AWS credentials or put them in browser code. Configure a budget alert before public traffic. The fixture is small, but API Gateway and Lambda can incur charges beyond free-tier allowances.
