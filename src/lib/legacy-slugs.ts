/**
 * Frozen slugs for the trees that were seeded before naming became optional.
 *
 * Slugs used to be derived from a tree's `name` (`slugify(record.name)`). That
 * was safe only while a name could never change: it was set once, at seed time,
 * and there was no route to edit it. Now that a steward can offer, rename, or
 * remove a name at any time, deriving the slug from the name would mean a tree's
 * public URL changes whenever its name does — silently, on the next reindex of
 * an empty database (see `maybeBackfillOnBoot`).
 *
 * So slugs no longer depend on `name` at all. New trees use their rkey, which is
 * immutable. The trees below already have name-derived slugs in the wild — in
 * links, in ActivityPub `Place.id`, in people's browser history — so those slugs
 * are pinned here and reproduce exactly on any fresh backfill.
 *
 * This map is closed. Nothing should ever be added to it: every tree seeded
 * after the image-forward revamp is keyed by its rkey.
 */
const LEGACY_SLUGS: Readonly<Record<string, string>> = Object.freeze({
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3menuunbehk2g':
    'brunswick-plane',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3menyf3k5bk24':
    'glorious-ginko',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mevjobcqzc2q':
    'finsbury-circus-planes',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mkagm672yc26':
    'elegant-plane',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mkzwiarwos26':
    'maple-by-the-canal',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mmqrlp3exc26':
    'reaching-oak',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mmtphyvpss26':
    'gnarly-oak',
  'at://did:plc:27737k2phovwfhzeii44bond/com.treeappreciation.tree/3mo765manzs26':
    'old-oak-clearing',
})

/** The pinned slug for a pre-revamp tree, or undefined for everything since. */
export function legacySlugForUri(uri: string): string | undefined {
  return LEGACY_SLUGS[uri]
}
