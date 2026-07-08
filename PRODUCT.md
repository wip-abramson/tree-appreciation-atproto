# Product

## Register

product

## Users

**Stewards and visitors of specific trees.** People who notice a particular tree — one they pass daily, one they returned to after years, one they encountered once — and want to leave or find a trace of meaning tied to that exact place.

- **Context of use:** almost always *at the tree*, outdoors, often on a phone, one-handed, briefly. The device is a threshold into an encounter, not the encounter itself. Interaction is short and purposeful; the primary experience happens with the tree, not on the screen.
- **The job to be done:** seed a persistent presence for a tree (a photo grounds it in place), add an inscription when an encounter feels worth marking, and — on return or discovery — sense continuity, change, and care left by others across seasons and years.
- **No single owner.** Stewardship is voluntary, plural, and uncoordinated. Multiple people tend the same tree with no consensus requirement and no moderation aesthetic.

## Product Purpose

Tree Appreciation is a **place-based memory scaffold** built on the AT Protocol. It gives each specific tree a persistent *presence* (not a profile) that accumulates inscriptions over time like memory rings. It exists to invite embodied attention to living trees, strengthen people's relationship to place, and preserve felt continuity across time — without encouraging consumption.

Success is **qualitative and non-extractive**: repeat visits across seasons, emergent rituals, accumulating climate observations, evidence of care. Explicitly *not* engagement, growth, or scale. The project privileges attention over reach.

Two record types in the `com.treeappreciation.*` namespace — `tree` and `inscription` — live in each user's own AT Protocol repo. Trees have no required name; identity is the photo plus an optional reverse-geocoded place label.

## Brand Personality

**Quiet, natural, unhurried.** Three words: *contemplative, rooted, plural.*

- **Voice:** gentle and invitational, never instructional or promotional. Prompts encourage physical presence and stillness ("listen before you inscribe") without lecturing. Silence is treated as valid participation.
- **Emotional goals:** calm, reverence, felt persistence. The interface should feel like crossing a threshold into an encounter — closer to a museum's hush or a field notebook than an app.
- **Aesthetic feel:** *quiet & contemplative* (generous stillness, muted restraint, nothing competing for attention) crossed with *natural & earthy* (botanical warmth, seasonal color, tactile/analog materiality). Warmth comes from imagery, type, and material — not from decoration.
- **Image-forward.** The tree's photograph carries identity and meaning; chrome recedes around it.

## Anti-references

Tree Appreciation must deliberately NOT look or feel like:

- **Social media** — no feeds, no infinite scroll, no like/follow counts, no engagement metrics, no avatars-everywhere or identity performance (avoid the Instagram/Twitter grammar). Metrics like inscription counts and handles exist only in the JSON API, never in the human-facing HTML.
- **SaaS dashboards** — no metric/KPI cards, no hero-metric templates, no gradient CTAs, no "growth product" polish.
- **Gamified / eco-apps** — no badges, streaks, progress bars, mascots, or cheerful sustainability gamification. Care is real, not scored.
- **Slick & trendy** — no glassmorphism, neon gradients, heavy motion, or of-the-moment visual fashion. The design should feel durable enough to still make sense in a decade.

## Design Principles

1. **Presence before interaction.** The interface directs attention outward to the environment, never inward to the device. Brief, purposeful sessions; no attention-capture loops. If a practice would still work without a given feature, question the feature (DESIGN_PRINCIPLES §11).
2. **Threshold, not destination.** The app is an entry point into an encounter, not a place to dwell. Provide orientation, not exploration; minimize steps to begin.
3. **Memory arrives like a gift.** Surface memory as encounter, not archive — at most one trace at a time, chosen by contextual resonance (season, time of day, weather), treated as an offering rather than an inventory to browse.
4. **Commons over ownership.** Trees are shared presences; no one owns a tree's narrative. Multiple perspectives coexist and need not agree. Care is visible; control is not.
5. **Continuity over accumulation.** The goal is layered meaning across time — perceivable seasonal and emotional change — not content volume or recency. Never optimize for "latest" or "most engaging."
6. **Minimal technological presence.** Technology is quiet, durable scaffolding. Prioritize longevity and low friction over novelty; resist feature creep.

## Accessibility & Inclusion

- **Target: WCAG 2.1 AA.** Body text ≥4.5:1 contrast (large text ≥3:1), full keyboard navigation, visible focus states, semantic markup, and a `prefers-reduced-motion` alternative for every animation (the timelapse crossfade especially).
- **Outdoor, one-handed, bright-light reality** should inform choices even though AA is the formal bar: legible at arm's length in sunlight, comfortable thumb reach on mobile, forgiving of brief and interrupted use.
- **Culturally open and non-prescriptive** (DESIGN_PRINCIPLES §7): plurality of practice is normalized; no single tradition, tone, or language of memory is centered.
