import { env } from '#/env'
import { Shell } from './shell'

type Props = { error?: string }

export function Login({ error }: Props) {
  const signupService =
    !env.PDS_URL || env.PDS_URL === 'https://bsky.social'
      ? 'Bluesky'
      : new URL(env.PDS_URL).hostname

  return (
    <Shell title="Log in" hideLoginLink>
      <div id="root">
        <div id="header">
          <h1>Tree Appreciation</h1>
          <p>Create lasting presences for the trees around you.</p>
        </div>
        <div className="container">
          <form action="/login" method="post" className="login-form">
            <input
              type="text"
              name="input"
              placeholder="Enter your handle (eg alice.bsky.social)"
              required
            />
            <button type="submit">Log in</button>
          </form>

          <a href="/signup" className="button signup-cta">
            Login or Sign up with a {signupService} account
          </a>

          {error ? (
            <p>
              Error: <i>{error}</i>
            </p>
          ) : null}
        </div>
      </div>
    </Shell>
  )
}
