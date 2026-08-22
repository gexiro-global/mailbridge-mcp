# Security policy

## Supported version

The latest release and the current `main` branch are supported.

## Reporting

Please use GitHub private vulnerability reporting for this repository. Do not
open a public issue containing a credential, token, private key, real email,
mailbox address, production hostname, or unredacted log.

## Public reference scope

This distribution is synthetic-only. It must not accept real mailbox
credentials and must not be represented as a production email connector.

Security invariants:

- no SMTP or mailbox write operations;
- no credential-bearing tool inputs;
- bounded message and attachment output;
- untrusted-content labeling;
- loopback-only binding by default;
- no production configuration or endpoints in the repository.

If a future contribution introduces real authentication, IMAP, persistence, or
public hosting, it requires a separate threat model and maintainer approval.
