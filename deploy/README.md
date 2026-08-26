# Deploy pack (Spotter ELD)

Canonical runbook: [`../docs/deploy/assessment-vehicledailycheck.md`](../docs/deploy/assessment-vehicledailycheck.md)

| File | Purpose |
|------|---------|
| `nginx/assessment.vehicledailycheck.com.conf` | SPA + `/api` → `:8001` |
| `systemd/spotter-eld-api.service` | gunicorn as `www-data` |
| `env.production.example` | Production `.env` template |
| `../scripts/deploy-spotter-eld.sh` | Idempotent pull/build/restart |

Routine:

```bash
cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh
```
