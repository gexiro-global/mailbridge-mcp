# Contributing

Contributions are welcome when they preserve tenant isolation, read-only IMAP
semantics and fail-closed Safe Send policy.

1. Use only reserved `.invalid` mailbox data in fixtures and reports.
2. Run `npm run check` and the relevant synthetic smoke test.
3. Document every tool schema, annotation, scope or resource URI change.
4. Add negative tests for authentication, data isolation and send gates.
5. Never add credentials, production endpoints, telemetry or external widget
   domains without maintainer review and a threat-model update.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
