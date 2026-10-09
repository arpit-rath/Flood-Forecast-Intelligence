# Fixture API deployment

`template.yaml` deploys the deterministic fixture API to API Gateway and Lambda. It has no secrets and cannot write reports, reviews, or closures. Every returned dataset identifies itself as synthetic `Scenario` data. `Live` requests return 503. This template is an integration checkpoint, not the full production architecture described in `Architecture.md`.

The Lambda package includes `backend/` and `data/fixture/`; deploy from the repository root with an AWS account and SAM CLI:

```powershell
sam build --template-file infra/template.yaml
sam deploy --guided --parameter-overrides AllowedOrigin=https://your-frontend.example
```

Set `AllowedOrigin` to the exact frontend origin. The API URL is an output of the stack. The deployed endpoint serves `GET /v1/pilot`, `GET /v1/snapshots/current?mode=Scenario`, `POST /v1/routes/compare`, and `POST /v1/interventions/compare`. Report mutation and media upload require a later persistent, authenticated implementation; the handler returns explicit 403/501 responses rather than pretending they succeeded.

Do not commit AWS credentials or put them in browser code. Configure a budget alert before public traffic. The fixture is small, but API Gateway and Lambda can incur charges beyond free-tier allowances.
