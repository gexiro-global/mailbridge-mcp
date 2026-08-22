## Summary

Describe the user-visible outcome and the smallest relevant implementation change.

## Security boundary

- [ ] Synthetic data only; no real mailbox, credential, token, or private endpoint.
- [ ] Zero SMTP or mailbox write operations.
- [ ] Tool annotations and output schemas match actual behavior.
- [ ] Email and attachment content remains untrusted and bounded.

## Verification

- [ ] `npm run check`
- [ ] Container build and smoke test, when runtime behavior changed.
- [ ] No secret or private identifier appears in the diff.
- [ ] Documentation and changelog are updated.
