# Renderer guidance

- Preserve UI behavior while extracting modules from `index.html`; do not reintroduce duplicate state or bypass the canonical game/session model.
- For game-card and detail changes, check long titles, portrait and landscape art, missing art, status changes, keyboard focus, wheel scrolling, and 90–120% scale.
- Test Ukrainian and English copy; keep visible states readable in all themes, including loading, empty, offline, and error states.
- Escape or safely render imported names, notes, URLs, and metadata. Never treat external source text as trusted HTML.
