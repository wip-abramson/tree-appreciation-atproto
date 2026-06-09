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
 * The quiet display label for a tree. Legacy trees keep their given name;
 * new trees are grounded by place instead. May be null — the photo is
 * the identity, a label is optional.
 */
export function treeLabel(tree: {
  name: string | null
  place: string | null
}): string | null {
  if (tree.name) return tree.name
  if (tree.place) return `near ${tree.place}`
  return null
}
