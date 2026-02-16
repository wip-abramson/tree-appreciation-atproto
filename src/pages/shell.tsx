import { env } from '#/env'

type User = {
  did: string
  displayName?: string
  handle?: string
  avatarUrl?: string
}

export function Shell({
  title,
  children,
  headContent,
  user,
}: {
  title: string
  children: React.ReactNode
  headContent?: React.ReactNode
  user?: User
}) {
  return (
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="icon" type="image/png" sizes="32x32" href="/public/favicon-32x32.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png" />
        <link rel="stylesheet" href="/public/styles.css" />
        {headContent}
      </head>
      <body>
        {user && (
          <div className="account-bar">
            <details className="account-menu">
              <summary>
                {user.avatarUrl ? (
                  <img
                    className="account-avatar"
                    src={user.avatarUrl}
                    alt=""
                  />
                ) : (
                  <span className="account-fallback">
                    {(user.displayName || user.handle || '?')[0].toUpperCase()}
                  </span>
                )}
              </summary>
              <div className="account-dropdown">
                <div className="account-name">
                  @{user.handle || user.did}
                </div>
                <form action="/logout" method="post">
                  <button type="submit" className="account-logout-btn">
                    Log out
                  </button>
                </form>
              </div>
            </details>
          </div>
        )}
        {children}
        {env.MOCK_WRITES && (
          <div className="mock-writes-badge">MOCK WRITES</div>
        )}
      </body>
    </html>
  )
}
