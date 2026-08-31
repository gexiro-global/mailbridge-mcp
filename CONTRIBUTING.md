# Contributing

Contributions are welcome when they preserve tenant isolation, read-only IMAP
semantics and fail-closed Safe Send policy.

1. Use only reserved `.invalid` mailbox data in fixtures and reports.
2. Run `npm run check` and the relevant synthetic smoke test.
3. Document every tool schema, annotation, scope or resource URI change.
4. Add negative tests for authentication, data isolation and send gates.
5. Never add credentials, production endpoints, telemetry or external widget
   domains without maintainer review and a threat-model update.

Use a Developer Certificate of Origin sign-off on every commit (`git commit -s`)
to affirm that you are entitled to submit the contribution under the project
license. Contributions without a valid `Signed-off-by` trailer may be asked to
replace their commits before review.

The review and decision process is documented in [GOVERNANCE.md](GOVERNANCE.md).
The project currently has one maintainer and does not claim independent
two-person review.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
