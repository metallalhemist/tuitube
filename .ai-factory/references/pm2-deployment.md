# PM2 Deployment Reference

> Source: https://doc.pm2.io/en/runtime/best-practices/environment-variables/
> Source: https://doc.pm2.io/en/runtime/features/commands-cheatsheet/
> Source: https://pm2.keymetrics.io/docs/usage/process-management/
> Created: 2026-05-01
> Updated: 2026-05-01

## Overview

PM2 manages Node.js applications as named background processes. For Tuitube's Telegram backend deployment, the important behavior is targeted restarts and environment refresh. PM2's CLI environment is conservative: restart/reload/stop/start actions do not automatically update environment variables unless `--update-env` is passed.

Use this reference when documenting or executing deployment steps for `TELEGRAM_API_ROOT`, `LOG_LEVEL`, queue limits, and other backend env changes.

## Core Concepts

Process name: PM2 commands can target a process by name, for example `tuitube-bot`. Targeting by name avoids affecting unrelated applications.

Restart: `pm2 restart <app>` restarts one application. `pm2 restart all` restarts all PM2-managed apps and should not be used for this project unless explicitly requested.

Environment refresh: PM2 does not apply new CLI environment variables on restart/reload by default. Add `--update-env` to apply the new environment.

Process list: `pm2 list` shows running applications and helps verify the exact process name before restart.

Show environment: `pm2 env <pm_id>` prints the active environment for a process id.

Logs: `pm2 logs` shows application logs. Prefer process-specific logs in production.

## API / Interface

### Common Commands

| Command | Purpose |
| --- | --- |
| `pm2 list` | List all managed applications. |
| `pm2 show <app_name>` | Show metadata for one application. |
| `pm2 restart <app_name>` | Restart one application. |
| `pm2 restart <app_name> --update-env` | Restart one application and refresh environment variables. |
| `pm2 restart all` | Restart every managed application. Avoid for Tuitube deploy steps. |
| `pm2 logs` | Show log stream. |
| `pm2 env <pm_id>` | Show environment for a process id. |
| `pm2 stop <app_name>` | Stop one application but keep it in PM2's process list. |
| `pm2 delete <app_name>` | Stop and remove one application from PM2. |

### Environment Update Form

```bash
ENV_VAR=somethingnew pm2 restart app --update-env
```

For Tuitube:

```bash
TELEGRAM_API_ROOT=http://127.0.0.1:18081 pm2 restart tuitube-bot --update-env
```

## Usage Patterns

### Restart Only Tuitube With Updated Env

```bash
pm2 list
pm2 show tuitube-bot
pm2 restart tuitube-bot --update-env
```

### Verify Current Environment

```bash
pm2 list
pm2 env <pm_id>
```

Use the process id for `tuitube-bot`, not another service.

### Tail Logs For Smoke Tests

```bash
pm2 logs tuitube-bot
```

If the PM2 version does not support process-specific `logs` in the local environment, use `pm2 logs` and filter carefully.

## Configuration

| Setting | PM2 behavior | Tuitube deployment guidance |
| --- | --- | --- |
| CLI env vars | New values are not applied on restart/reload unless `--update-env` is passed. | Always use `pm2 restart tuitube-bot --update-env` after changing backend env. |
| Ecosystem file env | PM2 docs state ecosystem file changes update environment. | Still verify with `pm2 env <pm_id>` when changing `TELEGRAM_API_ROOT`. |
| Process selection | PM2 can restart one app, multiple apps, or all apps. | Target `tuitube-bot` only. |

## Best Practices

1. Check `pm2 list` before deployment to confirm the exact process name.
2. Restart only `tuitube-bot` for Tuitube changes; avoid `pm2 restart all`.
3. Use `--update-env` when changing `TELEGRAM_API_ROOT`, `LOG_LEVEL`, `MAX_FILE_SIZE_MB`, or related environment variables.
4. Verify active env with `pm2 env <pm_id>` after deployment when diagnosing config issues.
5. Tail logs during smoke tests, but avoid pasting tokens or full secret-bearing URLs into issue reports.

## Common Pitfalls

1. Restarting without `--update-env` and expecting changed CLI env vars to apply.
2. Using `pm2 restart all` and disrupting unrelated services on the same host.
3. Changing an ecosystem file but not verifying the running process environment.
4. Confusing a PM2 process id with the app name and restarting the wrong process.

## Version Notes

PM2 docs are split across `doc.pm2.io` and `pm2.keymetrics.io`. Both document the same deployment-relevant behavior: targeted restarts are supported, and `--update-env` is required to refresh CLI-provided environment variables on restart/reload.
