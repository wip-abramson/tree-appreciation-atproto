export function ifString<T>(value: T): (T & string) | undefined {
  if (typeof value === 'string') return value
  return undefined
}

export function imageUrl(authorDid: string, imageCid: string): string {
  if (imageCid.startsWith('mock-')) {
    return `/mock-image/${imageCid}`
  }
  return `https://cdn.bsky.app/img/feed_fullsize/plain/${authorDid}/${imageCid}@jpeg`
}
