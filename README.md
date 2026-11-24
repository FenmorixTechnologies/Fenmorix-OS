# Fenmorix OS

Proprietary. © 2026 Fenmorix Technologies, LLC. All rights reserved. Not licensed for use, copying or distribution without a written
agreement with Fenmorix Technologies, LLC.

One code base, two presentations:

- **SGFD Nexus**: St. George Fire Protection District's own install (its name, seal, colors and documents).
- **Fenmorix OS**: every other customer, with their own name, logo, colors, menu names and only the modules their license turns on.

Each customer gets **their own download**, built from this repository by `packaging/build-package.mjs`. Nothing of one customer's
(modules they don't have, St. George's documents) goes into another's.

## Layout

| Folder | What |
|---|---|
| `src/` | The screens (React). `src/modules.js` = the module catalog licenses refer to. |
| `server/` | The server (Node, no framework) and its API. |
| `db/` | `schema.sql` + numbered migrations (each runs once per install). |
| `public/` | Icons and artwork (`public/brand-fenmorix/` = Fenmorix OS). |
| `scripts/` | Windows and Linux (`scripts/linux/`) install, update and backup scripts. |
| `packaging/` | Customer list (`customers.json`), which files belong to which module (`owners.json`), and the package builder. Never shipped. |
| `tools/license-manager/` | Fenmorix License Manager (keygen, issue, new-customer kits). Runs on the owner's computer only; the signing key is never in this repository. |
| `tests/` | End-to-end tests (Playwright) and their helpers. |
| `docs/` | St. George's Windows server guide and other notes. |
| `CLAUDE.md` | Detailed engineering notes, module by module. |

## Making the downloads

```
node packaging/build-package.mjs all          # every customer -> ../dist/<name>-<version>.zip
node packaging/build-package.mjs lgc          # one customer
```

A server's System page installs only the download made for it.

## Licenses

Licenses are Ed25519-signed files issued with `tools/license-manager` (`node nexus-license.mjs issue` or `new-customer`). The public key is in
`server/license.js`; the private key stays offline with the owner.
