# Deploy Spotter ELD (assessment.vehicledailycheck.com)

Isolated from Vehicle Daily Check on the same Vultr VPS.

| Piece | Value |
|-------|--------|
| URL | https://assessment.vehicledailycheck.com |
| Code | `/var/www/spotter-eld/` |
| DB | `spotter_eld` |
| gunicorn | `127.0.0.1:8001` |
| systemd | `spotter-eld-api.service` |
| nginx | `assessment.vehicledailycheck.com.conf` |

## One-time

1. DNS: `assessment.vehicledailycheck.com` → VPS IP (`78.141.194.242`).
2. SSH as a sudo-capable user (or `deploy` with sudo):

```bash
ssh vdc   # Host vdc in ~/.ssh/config
sudo bash /tmp/bootstrap_server.sh   # or clone first then:
# sudo bash /var/www/spotter-eld/repo/deploy/scripts/bootstrap_server.sh
```

3. Deploy app + build frontend:

```bash
sudo -u deploy bash /var/www/spotter-eld/repo/deploy/scripts/remote_deploy.sh
```

4. TLS:

```bash
sudo certbot --nginx -d assessment.vehicledailycheck.com
```

5. After certs exist, restore the full HTTPS nginx template from
   `deploy/nginx/assessment.vehicledailycheck.com.conf` if needed, then
   `sudo nginx -t && sudo systemctl reload nginx`.

## Refresh after code push

```bash
ssh vdc 'bash /var/www/spotter-eld/repo/deploy/scripts/remote_deploy.sh'
```

## Health checks

```bash
curl -fsS https://assessment.vehicledailycheck.com/api/health/
curl -I https://assessment.vehicledailycheck.com/
```

Do **not** edit VDC nginx/systemd/env under `/var/www/vehicledailycheck/`.
