This folder contains testing scaffolds beyond unit tests: functional, integration, performance, security, and UAT guidance.

Quick start:
- Functional & Integration: run `npm test` (Jest) from the backend folder.
- Performance: install Artillery globally or run `npx artillery run testing/perf/load-test.yml`.
- Security: use OWASP ZAP or run the example payloads in `testing/security` against the dev server.
- UAT: follow the checklist in `testing/uat/README.md` and leverage Playwright for automation.

Files added here are examples and starting points; adapt them to the full SRS and CI pipeline.
