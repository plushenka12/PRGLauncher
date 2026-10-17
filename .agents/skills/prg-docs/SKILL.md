---
name: prg-docs
description: Write or reconcile PRGLauncher Markdown documentation, README, roadmap, changelog, test guides, and release notes. Not for code-only changes without documentation impact.
---

# PRGLauncher Markdown documentation

Use current implementation and `package.json` as evidence; treat dated architecture, roadmap, and historical changelog as context rather than automatic truth.

- Preserve the purpose of each file: README for users, roadmap for planned/completed work, changelog for shipped changes, architecture for code/data boundaries, checklists for manual verification.
- Keep links relative within the repository and check that referenced files and commands exist. Use concise headings and ordinary Markdown that renders in GitHub.
- Distinguish implemented, tested, released, and planned. Do not silently move work between those states.
- Keep Ukrainian/English wording consistent with the document's audience; do not mix languages accidentally in a release description.
- Reconcile version-specific claims with `package.json` and the intended release tag. If the release target is not specified, avoid inventing one.
