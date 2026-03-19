import type { Tree } from '#/db'
import { imageUrl } from '#/lib/util'
import { Shell } from './shell'

type User = { did: string; displayName?: string; handle?: string; avatarUrl?: string }

type Props = {
  // Offering mode
  tree?: Tree
  treeHandle?: string
  inscriptionCount?: number
  totalTrees?: number
  // Search mode
  searchQuery?: string
  searchResults?: Tree[]
  treeCounts?: Record<string, number>
  didHandleMap?: Record<string, string | undefined>
  // Common
  user?: User
}

export function Home({
  tree,
  treeHandle,
  inscriptionCount,
  totalTrees,
  searchQuery,
  searchResults,
  treeCounts,
  didHandleMap,
  user,
}: Props) {
  const isSearch = searchQuery !== undefined

  return (
    <Shell title="Tree Appreciation" user={user}>
      <div className="home">
        <header className="home-header">
          <h1>Tree Appreciation</h1>
        </header>

        {isSearch ? (
          <SearchResults
            query={searchQuery}
            results={searchResults ?? []}
            treeCounts={treeCounts ?? {}}
            didHandleMap={didHandleMap ?? {}}
          />
        ) : tree ? (
          <Offering
            tree={tree}
            handle={treeHandle}
            inscriptionCount={inscriptionCount ?? 0}
          />
        ) : (
          <EmptyState loggedIn={!!user} />
        )}

        <footer className="home-footer">
          <form action="/" method="get" className="tree-search-form">
            <input
              type="text"
              name="q"
              placeholder="Find a tree by name..."
              defaultValue={searchQuery ?? ''}
              aria-label="Search trees"
            />
            <button type="submit">Search</button>
          </form>
          <div className="home-footer-links">
            {user ? (
              <a href="/seed-tree" className="home-seed-link">
                Seed a new tree presence
              </a>
            ) : (
              <a href="/login" className="home-seed-link">
                Log in to seed a tree
              </a>
            )}
            {totalTrees && totalTrees > 1 ? (
              <span className="home-tree-count">
                {totalTrees} trees have presence
              </span>
            ) : null}
          </div>
        </footer>
      </div>
    </Shell>
  )
}

function Offering({
  tree,
  handle,
  inscriptionCount,
}: {
  tree: Tree
  handle?: string
  inscriptionCount: number
}) {
  const imgSrc = tree.imageCid
    ? imageUrl(tree.authorDid, tree.imageCid)
    : null

  return (
    <div className="offering">
      <a href={`/tree/${tree.slug}`} className="offering-link">
        {imgSrc ? (
          <img className="offering-image" src={imgSrc} alt={tree.name} />
        ) : (
          <div className="offering-image-placeholder" />
        )}
        <h2 className="offering-name">{tree.name}</h2>
      </a>
      {tree.description ? (
        <p className="offering-description">{tree.description}</p>
      ) : null}
      <div className="offering-meta">
        {inscriptionCount > 0 ? (
          <span>
            {inscriptionCount} inscription{inscriptionCount !== 1 ? 's' : ''}
          </span>
        ) : (
          <span>No inscriptions yet</span>
        )}
        {handle ? (
          <span>
            seeded by @{handle}
          </span>
        ) : null}
      </div>
      <a href={`/tree/${tree.slug}`} className="offering-visit">
        Visit this tree
      </a>
    </div>
  )
}

function SearchResults({
  query,
  results,
  treeCounts,
  didHandleMap,
}: {
  query: string
  results: Tree[]
  treeCounts: Record<string, number>
  didHandleMap: Record<string, string | undefined>
}) {
  return (
    <div className="search-results">
      <p className="search-results-heading">
        {results.length === 0
          ? `No trees found for "${query}"`
          : `${results.length} tree${results.length !== 1 ? 's' : ''} found`}
      </p>
      {results.map((tree) => {
        const handle = didHandleMap[tree.authorDid] || tree.authorDid
        const count = treeCounts[tree.uri] || 0
        return (
          <a
            key={tree.uri}
            href={`/tree/${tree.slug}`}
            className="search-result"
          >
            <span className="search-result-name">{tree.name}</span>
            <span className="search-result-meta">
              {count} ring{count !== 1 ? 's' : ''}
              {' \u00b7 '}
              @{handle}
            </span>
          </a>
        )
      })}
    </div>
  )
}

function EmptyState({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div className="offering-empty">
      <p>No trees have been given presence yet.</p>
      {loggedIn ? (
        <a href="/seed-tree" className="offering-visit">
          Seed the first tree
        </a>
      ) : (
        <p className="offering-empty-login">
          <a href="/login">Log in</a> to seed the first tree presence.
        </p>
      )}
    </div>
  )
}
