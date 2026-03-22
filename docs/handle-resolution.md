# HTTPS Well-Known Handle Resolution: Analysis for Tree Appreciation

## Background

AT Protocol uses [handles](https://atproto.com/specs/handle) as human-friendly aliases for DIDs. Handles are DNS hostnames (e.g., `alice.bsky.social`) that must bidirectionally link to a DID: the handle resolves to the DID, and the DID document claims the handle.

Two resolution methods exist:

- **DNS TXT:** A `_atproto.` prefixed TXT record containing `did=did:plc:...`
- **HTTPS well-known:** Serve the DID as plain text at `https://<handle>/.well-known/atproto-did`

The HTTPS method is designed for large services managing many handles where DNS automation is impractical.

## What implementing it would require

To act as a handle provider (e.g., `alice.treeappreciation.app`), Tree Appreciation would need:

- **Wildcard DNS** pointing `*.treeappreciation.app` to our server
- **Wildcard SSL certificates** for HTTPS on all subdomains
- **Subdomain routing** to serve `/.well-known/atproto-did` per-user
- **A handle registry** — a new DB table mapping subdomains to DIDs, with claim/release flows
- **Verification logic** to confirm bidirectional linkage
- **Ongoing operational responsibility** — if the server goes down, every user with a Tree Appreciation handle becomes `handle.invalid`, and their PDS may block repo mutations

## Recommendation: Not worth it right now

Tree Appreciation is an indexer and viewer, not an identity provider. Users already have handles from their PDS (e.g., `*.bsky.social` or their own domain). The operational burden and risk of becoming a handle provider doesn't match the app's current role.

### Reasons against

- **Mismatched role.** The app indexes and displays tree records. It doesn't host accounts or manage identity.
- **Infrastructure overhead.** Wildcard DNS, SSL, subdomain routing, and a registration system add significant complexity for a feature that isn't core to the product.
- **Availability liability.** Downtime would degrade every user's identity, not just their Tree Appreciation experience.

### When it would make sense

- **Community identity signal.** If the Tree Appreciation community grows to a point where a `*.treeappreciation.app` handle becomes a meaningful marker of belonging — similar to how communities run custom handle domains on AT Protocol.
- **Tree identities.** If the architecture evolved so that trees themselves had DIDs (rather than being records in user repos), handle resolution could give trees human-readable names. This would be a significant architectural shift.

### Lighter alternatives

- A profile badge or contributor indicator in the UI to signal community membership without the operational cost of handle provisioning.
- Encouraging users to set their own domain handles and linking to instructions for doing so.
