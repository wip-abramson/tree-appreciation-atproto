import type { Tree } from '#/db'
import { Shell } from './shell'

type Props = {
  trees: Tree[]
  treeCounts: Record<string, number>
  didHandleMap: Record<string, string | undefined>
  profile?: { displayName?: string }
}

export function Home({ trees, treeCounts, didHandleMap, profile }: Props) {
  return (
    <Shell title="Tree Appreciation">
      <div id="root">
        <div className="error"></div>
        <div id="header">
          <h1>Tree Appreciation</h1>
          <p>Create lasting presences for the trees around you.</p>
        </div>
        <div className="container">
          <div className="card">
            {profile ? (
              <form action="/logout" method="post" className="session-form">
                <div>
                  Welcome back,{' '}
                  <strong>{profile.displayName || 'treekeeper'}</strong>.
                </div>
                <div>
                  <button type="submit">Log out</button>
                </div>
              </form>
            ) : (
              <div className="session-form">
                <div>
                  <a href="/login">Log in</a> to create a tree presence!
                </div>
                <div>
                  <a href="/login" className="button">
                    Log in
                  </a>
                </div>
              </div>
            )}
          </div>
          {profile ? (
            <a href="/seed-tree" className="seed-cta">
              Seed a tree
            </a>
          ) : null}

          <h2 className="section-title">Recent Trees</h2>
          {trees.length === 0 ? (
            <p className="empty-state">
              No trees yet. Be the first to create a tree presence!
            </p>
          ) : (
            <div className="tree-grid">
              {trees.map((tree) => {
                const handle = didHandleMap[tree.authorDid] || tree.authorDid
                const count = treeCounts[tree.uri] || 0
                return (
                  <a
                    key={tree.uri}
                    href={`/tree/${tree.slug}`}
                    className="tree-card"
                  >
                    {tree.imageCid ? (
                      <img
                        className="tree-card-image"
                        src={`https://cdn.bsky.app/img/feed_fullsize/plain/${tree.authorDid}/${tree.imageCid}@jpeg`}
                        alt={tree.name}
                      />
                    ) : (
                      <div className="tree-card-placeholder">No photo</div>
                    )}
                    <div className="tree-card-body">
                      <strong className="tree-name">{tree.name}</strong>
                      <div className="tree-card-meta">
                        <span className="tree-author">@{handle}</span>
                        <span className="tree-rings-badge">
                          {count} ring{count !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Shell>
  )
}
