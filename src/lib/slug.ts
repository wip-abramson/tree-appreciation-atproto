import type { Database } from '#/db'

/**
 * Convert a string into a URL-friendly slug.
 * Falls back to "tree" if the result is empty.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens

  return slug || 'tree'
}

/**
 * Find a unique slug by appending -N suffixes if needed.
 * `excludeUri` prevents self-conflict during firehose re-ingestion.
 */
export async function findUniqueSlug(
  db: Database,
  baseSlug: string,
  excludeUri?: string,
): Promise<string> {
  let query = db
    .selectFrom('tree')
    .select('slug')
    .where((eb) =>
      eb.or([
        eb('slug', '=', baseSlug),
        eb('slug', 'like', `${baseSlug}-%`),
      ]),
    )

  if (excludeUri) {
    query = query.where('uri', '!=', excludeUri)
  }

  const existing = await query.execute()
  const taken = new Set(existing.map((r) => r.slug))

  if (!taken.has(baseSlug)) return baseSlug

  let n = 1
  while (taken.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}
