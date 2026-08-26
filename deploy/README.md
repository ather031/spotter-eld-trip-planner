# Deploy assets

Production runbook: [`../docs/deploy/assessment-vehicledailycheck.md`](../docs/deploy/assessment-vehicledailycheck.md)

| File | Purpose |
|------|---------|
| `nginx/assessment.vehicledailycheck.com.conf` | SPA and `/api` proxy to `127.0.0.1:8001` |
| `systemd/spotter-eld-api.service` | Gunicorn service (`www-data`) |
| `env.production.example` | Production environment template |
| `../scripts/deploy-spotter-eld.sh` | Idempotent pull, build, and restart |

```bash
cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh
```
