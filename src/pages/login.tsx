import { env } from '#/env'
import { Shell } from './shell'

type Props = { error?: string }

const headContent = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600&display=swap"
      rel="stylesheet"
    />
  </>
)

const thresholdScript = `
(function() {
  var form = document.getElementById('threshold-form');
  var vow = document.getElementById('steward-vow');
  if (!form || !vow) return;
  var gated = form.querySelectorAll('[data-gated]');
  form.classList.add('is-gated');
  function sync() {
    var ok = vow.checked;
    form.classList.toggle('is-affirmed', ok);
    Array.prototype.forEach.call(gated, function(el) { el.disabled = !ok; });
  }
  vow.addEventListener('change', sync);
  sync();
})();
`

export function Login({ error }: Props) {
  const signupService =
    !env.PDS_URL || env.PDS_URL === 'https://bsky.social'
      ? 'Bluesky'
      : new URL(env.PDS_URL).hostname

  return (
    <Shell title="The steward's threshold" hideLoginLink headContent={headContent}>
      <main id="root" className="threshold">
        <a className="threshold-back" href="/">
          ← back to the grove
        </a>

        <div className="threshold-intro">
          <h1 className="threshold-title">Before you leave a mark</h1>
          <p className="threshold-lead">
            You rarely need to sign in — the grove is open to everyone who
            passes. Signing in only lets you seed a tree or leave an
            inscription, so it begins with a vow.
          </p>
        </div>

        <form id="threshold-form" action="/login" method="post" className="threshold-form">
          <blockquote className="vow" id="steward-vow-text">
            I come to these trees as a steward, not an owner. I will add only
            what deepens care, leave others' marks undisturbed, and return with
            attention rather than to be seen.
          </blockquote>

          <label className="vow-affirm" htmlFor="steward-vow">
            <input
              type="checkbox"
              id="steward-vow"
              name="vow"
              value="taken"
              required
              aria-describedby="steward-vow-text"
            />
            <span>I take up this care.</span>
          </label>

          <div className="threshold-auth">
            <label className="sr-only" htmlFor="handle">
              Your handle
            </label>
            <div className="handle-row">
              <input
                type="text"
                id="handle"
                name="input"
                placeholder="your handle — alice.bsky.social"
                autoComplete="username"
                required
              />
              <button type="submit" className="threshold-primary" data-gated disabled>
                cross the threshold
              </button>
            </div>

            <button
              type="submit"
              className="threshold-secondary"
              formAction="/signup"
              formMethod="post"
              formNoValidate
              data-gated
              disabled
            >
              New here? Continue with a {signupService} account.
            </button>
          </div>

          {error ? (
            <p className="threshold-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>

        <script dangerouslySetInnerHTML={{ __html: thresholdScript }} />
      </main>
    </Shell>
  )
}
