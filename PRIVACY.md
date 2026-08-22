# Privacy

The default MailBridge MCP Community distribution processes only synthetic
records committed to this repository. It does not connect to a mailbox, request
credentials, use analytics, set cookies, or persist user content.

When run locally, the server handles MCP requests in memory and sets
`Cache-Control: no-store`. It does not implement a telemetry exporter or a
database. Operators remain responsible for the privacy notice, access controls,
retention policy, and legal basis of any independently modified or hosted
deployment.

Do not submit real email, mailbox addresses, credentials, tokens, or production
logs in public issues. Use GitHub private vulnerability reporting for security
reports.
