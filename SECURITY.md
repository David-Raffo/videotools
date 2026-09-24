# Security Policy

## Supported versions

Only the latest version on the `main` branch receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub Security Advisories](https://github.com/David-Raffo/videotools/security/advisories/new).

You can expect an initial response within a few days.

## Deployment recommendations

- Always set `APP_PASSWORD` when the app is reachable from outside your machine.
- Expose the app only through a TLS reverse proxy; by default it binds to `127.0.0.1`.
- Mount `LIBRARY_ROOTS` folders read-only whenever possible.
