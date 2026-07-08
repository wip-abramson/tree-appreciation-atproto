import type { Tree, Inscription } from '#/db'
import type { Echo } from '#/routes'
import { imageUrl as buildImageUrl, treeLabel } from '#/lib/util'
import { Shell } from './shell'

type Props = {
  tree: Tree
  inscriptions: Inscription[]
  didHandleMap: Record<string, string | undefined>
  currentDid: string | null
  user?: { did: string; displayName?: string; handle?: string; avatarUrl?: string }
  echoes?: Echo[]
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

const imagePreviewScript = `
document.querySelector('.inscription-form input[type="file"]').addEventListener('change', function(e) {
  var preview = document.getElementById('inscription-preview');
  var datetimeField = document.getElementById('photo-taken-at');
  var feedback = document.getElementById('datetime-feedback');
  var file = e.target.files[0];
  if (file) {
    var reader = new FileReader();
    reader.onload = function(ev) {
      preview.src = ev.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
    if (typeof exifr !== 'undefined') {
      exifr.parse(file).then(function(exif) {
        var raw = exif && exif.DateTimeOriginal;
        if (raw instanceof Date && !isNaN(raw.getTime())) {
          var y = raw.getFullYear();
          var mo = String(raw.getMonth() + 1).padStart(2, '0');
          var d = String(raw.getDate()).padStart(2, '0');
          var h = String(raw.getHours()).padStart(2, '0');
          var mi = String(raw.getMinutes()).padStart(2, '0');
          datetimeField.value = y + '-' + mo + '-' + d + 'T' + h + ':' + mi;
          feedback.textContent = 'The photo remembers when it was taken.';
        }
      }).catch(function() {});
    }
  } else {
    preview.style.display = 'none';
    preview.src = '';
    datetimeField.value = '';
    feedback.textContent = '';
  }
});
`

const heroOrientationScript = `
(function() {
  var img = document.querySelector('.tree-hero-img');
  if (!img) return;
  function classify() {
    if (img.naturalWidth === 0) return;
    if (img.naturalHeight > img.naturalWidth) {
      img.closest('.tree-hero').classList.add('tree-hero--portrait');
    }
  }
  if (img.complete && img.naturalWidth > 0) classify();
  else img.addEventListener('load', classify);
})();
`

const timelapseScript = `
(function() {
  var lapse = document.getElementById('timelapse');
  if (!lapse) return;
  var frames = lapse.querySelectorAll('.lapse-frame');
  var dots = lapse.querySelectorAll('.lapse-dot');
  if (frames.length < 2) return;

  var idx = 0;
  var timer = null;
  var DWELL = 3500;
  var NEWEST_DWELL = 8000;

  function show(i) {
    idx = i;
    frames.forEach(function(f, n) { f.classList.toggle('is-active', n === i); });
    dots.forEach(function(d, n) { d.classList.toggle('is-active', n === i); });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function() {
      show((idx + 1) % frames.length);
      schedule();
    }, idx === frames.length - 1 ? NEWEST_DWELL : DWELL);
  }

  dots.forEach(function(d, n) {
    d.addEventListener('click', function() {
      show(n);
      schedule();
    });
  });

  // Rest while a hand is over it
  lapse.addEventListener('mouseenter', function() { clearTimeout(timer); });
  lapse.addEventListener('mouseleave', schedule);

  schedule();
})();
`

const deleteConfirmScript = `
document.querySelectorAll('.delete-form').forEach(function(form) {
  form.addEventListener('submit', function(e) {
    if (!confirm(form.dataset.confirm || 'Remove this?')) e.preventDefault();
  });
});
`

const mapScript = `
(function() {
  var el = document.getElementById('tree-map');
  if (!el) return;
  var lat = parseFloat(el.dataset.lat);
  var lng = parseFloat(el.dataset.lng);
  if (isNaN(lat) || isNaN(lng)) return;
  var map = L.map(el, {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    attributionControl: true
  }).setView([lat, lng], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\\u00a9 OpenStreetMap'
  }).addTo(map);
  L.circleMarker([lat, lng], {
    radius: 8,
    fillColor: '#3a7d2a',
    color: '#265c1a',
    weight: 2,
    fillOpacity: 0.9
  }).addTo(map);
})();
`

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function rkeyFromUri(uri: string): string {
  return uri.split('/').pop()!
}

/** A single photographic moment at this tree, in time order. */
type Moment = {
  src: string
  date: string
  text: string | null
  handle: string
  isYou: boolean
  /** Set for inscription moments owned by the viewer (enables tending) */
  deleteRkey: string | null
}

function gatherMoments(
  tree: Tree,
  inscriptions: Inscription[],
  didHandleMap: Record<string, string | undefined>,
  currentDid: string | null,
): Moment[] {
  const moments: Moment[] = []

  if (tree.imageCid) {
    moments.push({
      src: buildImageUrl(tree.authorDid, tree.imageCid),
      date: tree.photoTakenAt ?? tree.createdAt,
      text: null,
      handle: didHandleMap[tree.authorDid] || tree.authorDid,
      isYou: tree.authorDid === currentDid,
      deleteRkey: null,
    })
  }

  for (const inscription of inscriptions) {
    if (!inscription.imageCid) continue
    const isYou = inscription.authorDid === currentDid
    moments.push({
      src: buildImageUrl(inscription.authorDid, inscription.imageCid),
      date: inscription.photoTakenAt ?? inscription.createdAt,
      text: inscription.text,
      handle: didHandleMap[inscription.authorDid] || inscription.authorDid,
      isYou,
      deleteRkey: isYou ? rkeyFromUri(inscription.uri) : null,
    })
  }

  moments.sort((a, b) => a.date.localeCompare(b.date))
  return moments
}

function LapseFrame({ moment, active }: { moment: Moment; active: boolean }) {
  return (
    <figure className={active ? 'lapse-frame is-active' : 'lapse-frame'}>
      <img className="lapse-bg" src={moment.src} alt="" aria-hidden="true" />
      <img className="lapse-image" src={moment.src} alt="" />
      <figcaption className="lapse-caption">
        <span className="lapse-date">{formatDate(moment.date)}</span>
        {moment.text ? <span className="lapse-text">{moment.text}</span> : null}
        <span className="lapse-author">
          <a href={`https://bsky.app/profile/${moment.handle}`}>@{moment.handle}</a>
          {moment.deleteRkey ? (
            <form
              action={`/inscription/${moment.deleteRkey}/delete`}
              method="post"
              className="delete-form"
              data-confirm="Remove this moment?"
            >
              <button type="submit" className="delete-btn">remove</button>
            </form>
          ) : null}
        </span>
      </figcaption>
    </figure>
  )
}

const headContent = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link
      rel="preconnect"
      href="https://fonts.gstatic.com"
      crossOrigin="anonymous"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"
      rel="stylesheet"
    />
    <script src="https://cdn.jsdelivr.net/npm/exifr/dist/lite.umd.js"></script>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  </>
)

function actorDisplayName(echo: Echo): string {
  if (echo.actorName) return echo.actorName
  // Extract a readable name from the actor URL
  try {
    const url = new URL(echo.actorId)
    const parts = url.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || url.hostname
  } catch {
    return echo.actorId
  }
}

function echoLabel(type: Echo['type']): string {
  switch (type) {
    case 'follow':
      return 'is watching this tree'
    case 'like':
      return 'appreciates this tree'
    case 'announce':
      return 'shared this tree'
    case 'note':
      return ''
  }
}

function EchoItem({ echo }: { echo: Echo }) {
  const name = actorDisplayName(echo)
  const label = echoLabel(echo.type)

  return (
    <div className={`echo-item echo-item--${echo.type}`}>
      <div className="echo-actor">
        <a href={echo.actorId} className="echo-actor-link" target="_blank" rel="noopener noreferrer">
          {name}
        </a>
        {label ? <span className="echo-label">{label}</span> : null}
      </div>
      {echo.content ? (
        <p className="echo-content">{stripHtml(echo.content)}</p>
      ) : null}
      {echo.imageUrl ? (
        <img className="echo-image" src={echo.imageUrl} alt="" />
      ) : null}
      <span className="echo-date">{formatDate(echo.receivedAt)}</span>
    </div>
  )
}

export function TreeDetail({
  tree,
  inscriptions,
  didHandleMap,
  currentDid,
  user,
  echoes = [],
}: Props) {
  const authorHandle = didHandleMap[tree.authorDid] || tree.authorDid
  const label = treeLabel(tree)
  const imageUrl = tree.imageCid
    ? buildImageUrl(tree.authorDid, tree.imageCid)
    : null

  const moments = gatherMoments(tree, inscriptions, didHandleMap, currentDid)
  const firstYear = moments.length
    ? new Date(moments[0].date).getFullYear()
    : new Date(tree.createdAt).getFullYear()

  const wordsLeft = inscriptions.filter((i) => !i.imageCid && i.text)

  return (
    <Shell title={label ?? 'A tree'} headContent={headContent} user={user}>
      {/* Site header — compact on detail page */}
      <div className="tree-detail-header">
        <h1>
          <a href="/">Tree Appreciation</a>
        </h1>
      </div>

      {/* Zone 1: Hero */}
      {imageUrl ? (
        <div className="tree-hero">
          <img
            className="tree-hero-bg"
            src={imageUrl}
            alt=""
            aria-hidden="true"
          />
          <img className="tree-hero-img" src={imageUrl} alt={label ?? 'A tree'} />
          {label ? (
            <div className="tree-hero-overlay">
              <h2 className="tree-hero-name">{label}</h2>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="tree-hero tree-hero--no-image">
          <h2 className="tree-hero-name">{label ?? 'A tree'}</h2>
        </div>
      )}

      {/* Zone 2: Presence info */}
      <div className="tree-presence">
        {tree.description ? (
          <p className="tree-presence-description">{tree.description}</p>
        ) : null}
        <div className="tree-presence-meta">
          <span className="tree-meta-item">
            first noticed {formatDate(tree.createdAt)} by{' '}
            <a href={`https://bsky.app/profile/${authorHandle}`}>
              @{authorHandle}
            </a>
          </span>
        </div>
        {tree.latitude && tree.longitude ? (
          <>
            <div id="tree-map" className="tree-map" data-lat={tree.latitude} data-lng={tree.longitude}></div>
            <div className="tree-map-links">
              <a href={`https://www.openstreetmap.org/?mlat=${tree.latitude}&mlon=${tree.longitude}#map=16/${tree.latitude}/${tree.longitude}`} target="_blank" rel="noopener noreferrer">Open in OpenStreetMap</a>
              <span className="tree-map-links-sep">&middot;</span>
              <a href={`https://www.google.com/maps/search/?api=1&query=${tree.latitude},${tree.longitude}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
            </div>
          </>
        ) : null}
      </div>

      {/* Zone 3: Memory rings as timelapse */}
      <div className="lapse-section">
        {moments.length >= 2 ? (
          <>
            <h2 className="lapse-header">
              Through time{' '}
              <span>
                {moments.length} moments since {firstYear}
              </span>
            </h2>
            <div id="timelapse" className="lapse">
              {moments.map((moment, i) => (
                <LapseFrame key={i} moment={moment} active={i === 0} />
              ))}
              <div className="lapse-dots">
                {moments.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={i === 0 ? 'lapse-dot is-active' : 'lapse-dot'}
                    aria-label={`Moment ${i + 1}`}
                  ></button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="lapse-waiting">
            One moment so far. Return in another season — the tree will look
            different, and this page will begin to show time passing.
          </p>
        )}
      </div>

      {/* Words left without photos */}
      {wordsLeft.length > 0 ? (
        <div className="words-section">
          <h2 className="words-header">Words left here</h2>
          {wordsLeft.map((inscription) => {
            const handle =
              didHandleMap[inscription.authorDid] || inscription.authorDid
            const isYou = inscription.authorDid === currentDid
            return (
              <div key={inscription.uri} className="words-item">
                <p className="words-text">{inscription.text}</p>
                <span className="words-meta">
                  <a href={`https://bsky.app/profile/${handle}`}>@{handle}</a>
                  {' · '}
                  {formatDate(inscription.createdAt)}
                  {isYou ? (
                    <form
                      action={`/inscription/${rkeyFromUri(inscription.uri)}/delete`}
                      method="post"
                      className="delete-form"
                      data-confirm="Remove these words?"
                    >
                      <button type="submit" className="delete-btn">remove</button>
                    </form>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Zone 4: Inscription form — after the encounter, not before */}
      <div className="inscription-zone">
        {currentDid ? (
          <div className="inscription-form-wrapper">
            <h3>Were you here? Leave a moment.</h3>
            <form
              action="/inscription"
              method="post"
              encType="multipart/form-data"
              className="inscription-form"
            >
              <input type="hidden" name="tree" value={tree.uri} />
              <label>
                A photo of the tree as it is now
                <input
                  type="file"
                  name="image"
                  accept="image/*"
                />
              </label>
              <img id="inscription-preview" />
              <span id="datetime-feedback" className="datetime-feedback"></span>
              <input type="hidden" id="photo-taken-at" name="photoTakenAt" />
              <label>
                Words, if any come
                <textarea
                  name="text"
                  maxLength={1000}
                  rows={2}
                ></textarea>
              </label>
              <button type="submit">Inscribe</button>
            </form>
            <script
              dangerouslySetInnerHTML={{ __html: imagePreviewScript }}
            />
          </div>
        ) : (
          <div className="inscription-form-wrapper">
            <p className="inscription-login-prompt">
              <a href="/login">Log in</a> to leave a moment with this tree.
            </p>
          </div>
        )}
      </div>

      {/* Zone 5: Fediverse echoes */}
      {echoes.length > 0 ? (
        <div className="echoes-section">
          <h2 className="echoes-header">
            Echoes from the fediverse{' '}
            <span>
              {echoes.length} echo{echoes.length !== 1 ? 'es' : ''}
            </span>
          </h2>
          <div className="echoes-list">
            {echoes.map((echo, i) => (
              <EchoItem key={i} echo={echo} />
            ))}
          </div>
        </div>
      ) : null}

      <script
        dangerouslySetInnerHTML={{ __html: heroOrientationScript }}
      />
      <script
        dangerouslySetInnerHTML={{ __html: timelapseScript }}
      />
      <script
        dangerouslySetInnerHTML={{ __html: mapScript }}
      />
      <script
        dangerouslySetInnerHTML={{ __html: deleteConfirmScript }}
      />
    </Shell>
  )
}
