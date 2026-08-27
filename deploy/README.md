# Deploy configs

Production runbook: [`../docs/deploy/assessment-vehicledailycheck.md`](../docs/deploy/assessment-vehicledailycheck.md)

| File | Purpose |
|------|---------|
| `nginx/assessment.vehicledailycheck.com.conf` | SPA and `/api` proxy to `127.0.0.1:8001` |
| `systemd/spotter-eld-api.service` | gunicorn as `www-data` |
| `env.production.example` | Production `.env` template |
| `../scripts/deploy-spotter-eld.sh` | Pull, build, migrate, restart |

Redeploy:

```bash
cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh
```
