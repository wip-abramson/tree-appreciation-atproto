---
target: home.tsx
total_score: 30
p0_count: 0
p1_count: 1
timestamp: 2026-07-08T19-36-21Z
slug: src-pages-home-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Orient/hover feedback good; no image loading skeleton; distance labels not announced (no aria-live) |
| 2 | Match System / Real World | 4 | Domain-poetic language throughout; nothing alien |
| 3 | User Control and Freedom | 3 | Orient is one-way — disables itself, no reset to shuffled grove without reload |
| 4 | Consistency and Standards | 3 | Name placement jumps top (broken-img alt) vs bottom (place label) |
| 5 | Error Prevention | 3 | Little to prevent; geolocation denial handled gracefully |
| 6 | Recognition Rather Than Recall | 3 | RingsMark meaning lives only in a hover `<title>` |
| 7 | Flexibility and Efficiency | 3 | No shortcuts/filters/search — largely intentional for a "threshold" |
| 8 | Aesthetic and Minimalist Design | 4 | Image-forward, uncluttered, every element earns its place |
| 9 | Error Recovery | 2 | 404 image → native broken-image glyph + alt overflow; no graceful placeholder fallback |
| 10 | Help and Documentation | 2 | None; RingsMark/orient/"seed" concepts have no first-timer affordance |
| **Total** | | **30/40** | **Good** — solid foundation; address error state, touch reveal, contrast |

## Anti-Patterns Verdict

**Does this look AI-generated? No — genuinely crafted, low-slop, with a real point of view.**

**LLM assessment:** Editorial serif system (Newsreader italic display, Source Serif 4 body, DM Mono micro-labels) on warm paper `#f7f5f2`, muted forest greens rather than eco-bright, literary microcopy ("the grove", "words left here", "seed its presence"), and a concentric-ring memory mark. No metrics, no handles, no shouting CTAs — the anti-references (feeds/dashboards/gamified-eco) are genuinely avoided. Category-reflex check: first-order palette (green ramp) is somewhat guessable from "tree app" but redeemed by execution; second-order aesthetic is not guessable. Residual tells are seasoning only: the ubiquitous "delightful card" hover kit (translateY + scale(1.04) + shadow-bloom on cubic-bezier(0.22,1,0.36,1)) and a `backdrop-filter: blur` distance pill (literal glassmorphism, on the anti-reference list).

**Deterministic scan:** `detect.mjs --json src/pages/home.tsx src/pages/shell.tsx` → exit 0, findings `[]`. Markup is clean; no automated slop tells. Confirms the LLM read.

**Browser evidence:** Page renders; no JS exceptions; no horizontal overflow at 1280px or 390px (mobile collapses to a clean 2-column grid). 2 console errors, both image 404s. Contrast measured live from computed styles (see Priority Issues). Grove holds 3 cards but 2/3 images 404 in the dev mock store — surfacing the error state below.

## What's Working

1. **Editorial restraint + authored voice.** The serif/mono type system, warm paper ground, and literary microcopy give a distinct anti-slop identity that directly serves presence-first design. Zero metrics/handles in the HTML — confirmed.
2. **Unranked, shuffled, image-forward grid (Aesthetic = 4).** No "latest/top/trending" framing; square photos on a quiet ground honor continuity-over-accumulation. The design's high point.
3. **Tasteful progressive disclosure with real craft.** Hover timelapse, orient-on-demand distance labels, RingsMark signal — all gated on `matchMedia` hover capability and `prefers-reduced-motion`, with a dedicated reduced-motion CSS block. Focus-visible states are real and well-tuned.

## Priority Issues

**[P1] Broken-image state is ungraceful and destroys the tone.** When an image URL 404s, the card shows the browser's native broken-image glyph with the `alt` (tree name) spilling across the top-left, colliding with RingsMark. `home.tsx` L199–208; the `.grove-card-placeholder` gradient (`styles.css` L552) renders only when `imageCid` is null, never on a failed load. Confirmed live on 2/3 cards. The page's whole emotional weight rests on a few photos; one broken image reads as neglect on a site about care, and a deleted blob / missing image-table row reproduces it in production. Fix: `onerror` handler that hides the `<img>` and reveals the placeholder gradient; ideally resolve missing CIDs server-side. → `/impeccable harden`

**[P2] The core "gift" (timelapse) is desktop-only.** Crossfade + RingsMark tooltip fire only under `matchMedia('(hover: hover)')` (`home.tsx` L22). Touch users see static images and never learn a tree has multiple moments — contradicting principle 3 for the majority mobile/outdoor audience the app is built for. Fix: on touch, reveal moments via tap-to-advance or a slow in-viewport auto-crossfade (respect reduced-motion/data-saver). → `/impeccable animate`

**[P2] Low text contrast fails WCAG AA on the two framing prose elements.** Measured live: `.tagline` `#9e8a72` on `#fff` = **3.32:1**; `.grove-foot` `#9e8a72` on `#f7f5f2` = **3.05:1** (`styles.css` L375, L478). Both are normal-size prose; AA requires 4.5:1. Outdoor/bright-sun mobile use is an explicit bar. Fix: darken to ≥ `--bark-500 #6e5c46` (≈5.5:1) or increase size/weight. (Also watch `.grove-card-distance`: white ~10.9px on rgba(20,14,8,.5) over a light photo bounds ≈3.6:1 — potential fail.) → `/impeccable colorize`

**[P2] Orient is one-way with no escape back to the grove.** After "find the trees near you", `orient()` sets `disabled = true` and relabels (`home.tsx` L113–117). No way to restore shuffled order without a full reload — a mistaken tap or a wish for serendipity leaves the user stuck. Fix: make it a toggle ("nearest you" ⇄ "shuffle the grove") that re-sorts. → `/impeccable shape`

**[P3] RingsMark legibility and affordance.** 22px concentric SVG, white at 0.82 opacity, pinned top-left where it collides with broken-image alt; meaning lives only in a hover `<title>` and the wrapper is `aria-hidden` (`home.tsx` L146–158). Easy to miss; no touch/SR affordance; the `<title>` instructs a hover action keyboard/touch users can't do. Fix: accessible label describing the state (not the action); guarantee no overlap with other overlays. → `/impeccable clarify`

## Persona Red Flags

**Jordan (first-timer):** No "what is this / about" beyond one tagline (Help = 2). RingsMark is an unlabeled icon; the `✦` orient mark is decorative and unexplained; "seed its presence" is poetic but opaque. No scaffolding — may bounce unsure what the site is for.

**Casey (distracted mobile, outdoors):** The signature timelapse never fires (hover-only) — sees only static images and misses the point. Low-contrast tagline/footer wash out in sunlight. Broken images are likeliest on flaky mobile connections. Cards are thumb-friendly, but the corner "log in" links are small ~0.9rem targets.

**Sam (accessibility):** Tagline + footer fail 4.5:1. RingsMark `<title>` instructs a hover interaction SR/keyboard users can't perform, and the span is `aria-hidden` so its nuance is lost. Distance labels injected on orient aren't in an `aria-live` region — nothing announced. Genuine plus: focus-visible states are real and well-tuned.

**Maya, the contemplative steward (project persona):** Standing under her own tree, phone in bright sun, she must scan a shuffled grid to find it — no "my trees", and shuffle-on-every-load means what moved her last visit has moved. The timelapse she seeded won't play on her phone. Sunlight + low-contrast prose. The memory-rings mark she'd most value is nearly invisible at 22px/0.82.

## Minor Observations

- **Stale docs:** CLAUDE.md says the grove has "a map of presences"; current `home.tsx` has no map, only the distance-sort orient button. B confirmed no map renders. Update the doc.
- **Name shown twice** for legacy named trees in the broken state (alt overlay top + `.grove-card-place` bottom).
- **No dark mode** (no `prefers-color-scheme`); a dusk theme would serve evening outdoor use.
- **Mock-writes badge** (`#f59e0b` amber) is the most saturated element on the page — jarring against the muted palette (dev-only).
- **Sparse at low counts:** `minmax(200px, 1fr)` with 3 trees leaves ~60% of desktop viewport empty; can read as unfinished until the grove grows.
- Broken images are a dev mock-store data-staleness issue (`src/lib/mock-image-store.ts`), not a markup defect — but the P1 fix (graceful fallback) applies to production 404s too.

## Questions to Consider

- If "memory arrives like a gift, one trace at a time", why does the grove present every tree at once? Would a single resonant tree (by season/time/place) be a truer threshold?
- The core delight is invisible to the mobile-outdoor audience the app exists for. Is hover the right trigger, or should presence unfold on scroll or tap?
- Should a returning steward ever be able to find their own tree — or does "commons over ownership" deliberately refuse that, at the cost of Maya's frustration?
- What does the grove feel like at 200 trees vs 3? Does reshuffling on every load create serendipity, or just disorient someone trying to return?
