export function ifString<T>(value: T): (T & string) | undefined {
  if (typeof value === 'string') return value
  return undefined
}

export function imageUrl(authorDid: string, imageCid: string): string {
  if (imageCid.startsWith('mock-')) {
    return `/mock-image/${imageCid}`
  }
  return `/img/${imageCid}`
}

export function upstreamImageUrl(authorDid: string, imageCid: string): string {
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${imageCid}@jpeg`
}

/**
 * Where the tree is, in the physical world. Objective, reverse-geocoded, and
 * true for everyone. May be null — the photo is the identity.
 *
 * This is what the tree page shows over the photograph. A person's name for a
 * tree never appears there: rendered as a title it would read as *the tree's*
 * name, and on AT Protocol only the seeder can write the tree record — so a
 * title would quietly hand the first photographer a naming monopoly. Names are
 * shown attributed instead, beside the person who offered them.
 */
export function treeGrounding(tree: { place: string | null }): string | null {
  if (tree.place) return `near ${tree.place}`
  return null
}

/**
 * A plain wayfinding label: browser tab titles, grove captions, and the
 * ActivityPub `Place.name`. These are strings that help someone find or
 * refer to a tree, not claims about who it belongs to, so a given name is
 * allowed to stand in for a place here. Legacy trees have names but no
 * place, and this is what keeps them findable. May be null.
 */
export function treeLabel(tree: {
  name: string | null
  place: string | null
}): string | null {
  if (tree.name) return tree.name
  return treeGrounding(tree)
}
