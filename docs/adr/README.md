# Architecture decision records

Why the repository is a kit of packages and not one app with a `shared/` folder. Decided 2026-10-18.

| ADR | Decision |
| --- | --- |
| [0001](0001-everything-is-a-versioned-package.md) | Everything is a versioned package, customised through a closed list of extension points |
| [0002](0002-business-modules-are-packages.md) | Business modules are packages |
| [0003](0003-integrations-live-in-the-producer.md) | A producer describes itself to optional consumers (`integrations/`) |
| [0004](0004-privacy-protocol-is-a-kit-package.md) | The privacy participation protocol is a kit package |
| [0005](0005-config-is-sliced-per-owner.md) | Configuration is sliced, one slice per owner |
| [0006](0006-start-small-and-add.md) | A new project starts from a small starter and adds modules |

A new extension point needs an ADR of its own: the list is closed on purpose.
