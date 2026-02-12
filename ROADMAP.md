# Tree Appreciation — Roadmap

## Deploy first, then iterate

**Ship now.** The app is functional: tree creation with photo/GPS, inscriptions with images and EXIF dates, memory ring timeline, OAuth login. That's a complete loop. Get it in front of testers.

**Test data:** Yes, you can delete it. ATProto records live in your PDS repo — you can delete them with `com.atproto.repo.deleteRecord()` (per collection + rkey). The ingester already handles firehose delete events and removes them from the local SQLite index. You could also simply wipe the SQLite DB file and let the firehose re-index from scratch. One practical step: we should add a **delete button** to the UI (tree detail page, your own inscriptions) before launch so testers can clean up after themselves too.

---

## Feature roadmap (recommended order)

### Phase 1: Richer TreeDetail views
**Why first:** Highest immediate value, builds entirely on existing data, no new ATProto primitives needed. Makes the core experience compelling before adding social layers.

Possible views/modes for a tree's memory:
- **Timeline** (current default) — chronological ring display
- **Gallery** — grid/mosaic of inscription photos, tap to expand
- **Seasonal** — group inscriptions by season/month, see the tree across time of year
- **By author** — filter by treekeeper, see one person's relationship with the tree
- **Map view** — if inscriptions gain location data, show where people visited from

Implementation: mostly frontend (new view components in `src/pages/tree-detail.tsx`, CSS, query params or tabs to switch). Could add a view switcher UI at the top of the rings section.

### Phase 2: Sociality — follow trees & treekeepers
**Why second:** Creates engagement loops and return visits. Gives people a reason to come back.

Two follow primitives:
- **Follow a tree** — new lexicon `com.treeappreciation.follow` with `subject` (AT URI of a tree). Creates a "My Trees" page showing trees you follow with recent activity.
- **Follow a treekeeper** — could reuse `app.bsky.graph.follow` (standard ATProto) or a custom record. Shows activity from treekeepers you follow.

New surfaces:
- "My Trees" / "Following" page — personalized feed of recent inscriptions on trees you follow
- Follow/unfollow button on tree detail page
- Notification concept — "3 new inscriptions on trees you follow"
- Treekeeper profile page — list of trees they've seeded and inscriptions they've made

### Phase 3: Labelling & curation
**Why third:** Depends on having enough inscriptions and social context to make curation meaningful. The tree seeder (original creator) gets special curation powers.

Design:
- Tree seeder can **label inscriptions** — e.g. "featured", "hidden" (moderation), or custom tags
- Could use ATProto's native label system (`com.atproto.label`) or a custom `com.treeappreciation.curation` record type
- Featured inscriptions shown by default; others accessible via "show all"
- Labels feed into Phase 2's personalized feeds — "featured inscriptions on trees I follow"

Curation model: **Seeder initially, with ability to grant curation rights to other treekeepers later.** Needs more design thought at build time — parking this for Phase 3.

### Phase 4: AI tree voices
**Why last:** Most experimental, benefits from accumulated data, and is the most open-ended design space. Better to have a rich corpus of inscriptions before training a voice.

Concept: AI agents that synthesize a tree's "personality" from its accumulated memories and speak on its behalf.

Direction: **Start with narrator, then explore conversational.**

- **Phase 4a: Narrator** — AI periodically generates reflections or seasonal summaries from accumulated inscriptions, displayed as a special inscription type. A tree's "voice" emerges from the collective memory.
- **Phase 4b: Conversational** — Users can talk to a tree, with responses grounded in its inscription history. The tree answers from its accumulated experience.

Implementation considerations:
- New record type for AI-generated content? Or special inscription with `source: "ai"` flag?
- Claude API integration server-side
- Grounding/RAG over the tree's inscription corpus
- Clear visual distinction between human inscriptions and AI-generated content
- Consent model — does the seeder opt a tree into AI voice?

---

## Summary

| Phase | Feature | New ATProto primitives | Complexity |
|-------|---------|----------------------|------------|
| 0 | **Deploy + delete buttons** | None | Low |
| 1 | Richer TreeDetail views | None | Medium |
| 2 | Follow trees & treekeepers | `com.treeappreciation.follow` | Medium-High |
| 3 | Labelling & curation | Labels or custom record | Medium-High |
| 4 | AI tree voices | Possibly new record type | High |
