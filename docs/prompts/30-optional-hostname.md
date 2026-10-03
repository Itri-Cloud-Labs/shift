# 30. Add the optional DNS hostname contract and setup flow

Read [COMMON.md](COMMON.md).

Prerequisites: [28](28-linux-operation.md). Roadmap: M14b. Can run with 29 and 31.

Read server sections 4.4, 10, and 14; client sections 4.1 and 5.1. Implement replaceable issuer client interfaces for claim/confirm/update/release, an isolated fixture issuer within the existing workspace tooling, and persisted server registration/status. Detailed production DNS-provider service deployment is a separate operator component; do not add another application/workspace or invent credentials here.

Claim reserves a hostname; expiring address-control proof precedes publishing A/AAAA. Validate public targets, bound registrations/updates, and keep pending DNS operation status distinct from confirmation. Management tokens are separate encrypted server credentials, not device pairing tokens. Challenge endpoints expose only the short-lived proof. Avoid fetching arbitrary issuer-provided destinations without containment/validation.

Provide the production issuer transport adapter and CLI claim/status/update/release operations with recovery of uncertain operations. Document the issuer/provider/domain prerequisites needed to verify a live deployment. Record failure/renewal status while retaining user-supplied direct URL access. The optional DNS service handles no workflow traffic or device/GitHub secrets.

Add client hostname/onboarding/status forms and HTTPS guidance. DNS assignment never implies TLS provisioning; certificate/identity verification remains enabled.

Acceptance:

- Fixture issuer proves claim/confirmation/update/release and refusal of nonpublic/invalid/unproven targets.
- Interrupt claim/DNS update, then reconcile or report uncertainty rather than silently duplicate registrations.
- Issuer/DNS failure leaves headless execution and custom-address connection usable.
- Token isolation and challenge expiry pass checks. Mark production domain/provider evidence unverified until real prerequisites are supplied.
