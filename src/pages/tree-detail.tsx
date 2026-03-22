import type { Tree, Inscription } from '#/db'
import type { Echo } from '#/routes'
import { imageUrl as buildImageUrl } from '#/lib/util'
import { Shell } from './shell'

type Props = {
  tree: Tree
  inscriptions: Inscription[]
  didHandleMap: Record<string, string | undefined>
  currentDid: string | null
  user?: { did: string; displayName?: string; handle?: string; avatarUrl?: string }
  echoes?: Echo[]
}

const imagePreviewScript = `
document.querySelector('.inscription-form input[type="file"]').addEventListener('change', function(e) {
  var preview = document.getElementById('inscription-preview');
  var datetimeLabel = document.getElementById('photo-taken-at-label');
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
    datetimeLabel.style.display = '';
    if (typeof exifr !== 'undefined') {
      exifr.parse(file).then(function(exif) {
        console.log('[tree-detail] exifr.parse result:', exif);
        console.log('[tree-detail] DateTimeOriginal:', exif && exif.DateTimeOriginal, typeof (exif && exif.DateTimeOriginal));
        var raw = exif && exif.DateTimeOriginal;
        if (raw instanceof Date && !isNaN(raw.getTime())) {
          var y = raw.getFullYear();
          var mo = String(raw.getMonth() + 1).padStart(2, '0');
          var d = String(raw.getDate()).padStart(2, '0');
          var h = String(raw.getHours()).padStart(2, '0');
          var mi = String(raw.getMinutes()).padStart(2, '0');
          datetimeField.value = y + '-' + mo + '-' + d + 'T' + h + ':' + mi;
          feedback.textContent = 'Photo date extracted from image';
        } else {
          console.log('[tree-detail] DateTimeOriginal not a valid Date, raw value:', raw);
        }
      }).catch(function(err) {
        console.error('[tree-detail] exifr.parse error:', err);
      });
    } else {
      console.log('[tree-detail] exifr not loaded');
    }
  } else {
    preview.style.display = 'none';
    preview.src = '';
    datetimeLabel.style.display = 'none';
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

const ringImageOrientationScript = `
(function() {
  function classify(img) {
    if (img.naturalWidth === 0) return;
    if (img.naturalHeight > img.naturalWidth) {
      img.classList.add('ring-image--portrait');
    } else {
      img.classList.add('ring-image--landscape');
    }
  }
  document.querySelectorAll('.ring-image').forEach(function(img) {
    if (img.complete && img.naturalWidth > 0) classify(img);
  });
  document.addEventListener('load', function(e) {
    if (e.target && e.target.classList && e.target.classList.contains('ring-image')) {
      classify(e.target);
    }
  }, true);
})();
`

function ringAge(index: number, total: number): string {
  if (total <= 1) return 'ring--newest'
  if (index === total - 1) return 'ring--newest'
  const position = index / (total - 1)
  if (position < 0.4) return 'ring--old'
  if (position < 0.75) return 'ring--mid'
  return 'ring--recent'
}

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

function RingItem({
  inscription,
  index,
  total,
  handle,
  isYou,
}: {
  inscription: Inscription
  index: number
  total: number
  handle: string
  isYou: boolean
}) {
  const age = ringAge(index, total)
  const isTextOnly = !inscription.imageCid && inscription.text
  const classes = [
    'ring-marker',
    age,
    isTextOnly ? 'ring-text-only' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {inscription.imageCid ? (
        <img
          className="ring-image"
          src={buildImageUrl(inscription.authorDid, inscription.imageCid)}
          alt="Inscription photo"
        />
      ) : null}
      {inscription.photoTakenAt ? (
        <div className="ring-photo-date">
          {formatDate(inscription.photoTakenAt)}
        </div>
      ) : null}
      {inscription.text ? (
        <p className="ring-text">{inscription.text}</p>
      ) : null}
      <div className="ring-meta">
        <a
          href={`https://bsky.app/profile/${handle}`}
          className="ring-author"
        >
          @{handle}
        </a>
        {isYou ? <span className="ring-you">you</span> : null}
        <span className="ring-date">{formatDate(inscription.createdAt)}</span>
        {isYou ? (
          <form
            action={`/inscription/${rkeyFromUri(inscription.uri)}/delete`}
            method="post"
            className="delete-form"
            onSubmit="return confirm('Delete this inscription?')"
          >
            <button type="submit" className="delete-btn">delete</button>
          </form>
        ) : null}
      </div>
    </div>
  )
}

const COLLAPSE_THRESHOLD = 15

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
        <p className="echo-content" dangerouslySetInnerHTML={{ __html: echo.content }} />
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
  const imageUrl = tree.imageCid
    ? buildImageUrl(tree.authorDid, tree.imageCid)
    : null

  const olderCount =
    inscriptions.length > COLLAPSE_THRESHOLD
      ? inscriptions.length - COLLAPSE_THRESHOLD
      : 0
  const olderInscriptions = inscriptions.slice(0, olderCount)
  const visibleInscriptions = inscriptions.slice(olderCount)

  return (
    <Shell title={tree.name} headContent={headContent} user={user}>
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
          <img className="tree-hero-img" src={imageUrl} alt={tree.name} />
          <div className="tree-hero-overlay">
            <h2 className="tree-hero-name">{tree.name}</h2>
          </div>
        </div>
      ) : (
        <div className="tree-hero tree-hero--no-image">
          <h2 className="tree-hero-name">{tree.name}</h2>
        </div>
      )}

      {/* Zone 2: Presence info */}
      <div className="tree-presence">
        {tree.description ? (
          <p className="tree-presence-description">{tree.description}</p>
        ) : null}
        <div className="tree-presence-meta">
          {tree.latitude && tree.longitude ? (
            <span className="tree-meta-item">
              {tree.latitude}, {tree.longitude}
            </span>
          ) : null}
          <span className="tree-meta-item">
            seeded by{' '}
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

      {/* Zone 3: Inscription form */}
      <div className="inscription-zone">
        {currentDid ? (
          <div className="inscription-form-wrapper">
            <h3>Leave your mark</h3>
            <form
              action="/inscription"
              method="post"
              encType="multipart/form-data"
              className="inscription-form"
            >
              <input type="hidden" name="tree" value={tree.uri} />
              <label>
                Add a photo
                <input
                  type="file"
                  name="image"
                  accept="image/*"
                />
              </label>
              <img id="inscription-preview" />
              <span id="datetime-feedback" className="datetime-feedback"></span>
              <label id="photo-taken-at-label" style={{ display: 'none' }}>
                Photo taken at (optional)
                <input type="datetime-local" id="photo-taken-at" name="photoTakenAt" />
                <span className="form-hint">Auto-filled from photo if available</span>
              </label>
              <label>
                Caption or note (optional)
                <textarea
                  name="text"
                  placeholder="What do you notice about this tree today?"
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
              <a href="/login">Log in</a> to leave your mark on this tree.
            </p>
          </div>
        )}
      </div>

      {/* Zone 4: Memory rings */}
      <div className="rings-section">
        <h2 className="rings-header">
          Memory Rings{' '}
          <span>
            {inscriptions.length} inscription
            {inscriptions.length !== 1 ? 's' : ''}
          </span>
        </h2>

        {inscriptions.length === 0 ? (
          <div className="rings-empty">
            <div className="rings-empty-marker">
              <p className="rings-empty-text">
                No inscriptions yet. Be the first to leave your mark.
              </p>
            </div>
          </div>
        ) : (
          <div className="rings-trunk">
            {olderCount > 0 ? (
              <details className="rings-older-toggle">
                <summary>
                  {olderCount} older inscription
                  {olderCount !== 1 ? 's' : ''}
                </summary>
                {olderInscriptions.map((inscription, i) => {
                  const handle =
                    didHandleMap[inscription.authorDid] ||
                    inscription.authorDid
                  const isYou = inscription.authorDid === currentDid
                  return (
                    <RingItem
                      key={inscription.uri}
                      inscription={inscription}
                      index={i}
                      total={inscriptions.length}
                      handle={handle}
                      isYou={isYou}
                    />
                  )
                })}
              </details>
            ) : null}
            {visibleInscriptions.map((inscription, i) => {
              const actualIndex = olderCount + i
              const handle =
                didHandleMap[inscription.authorDid] || inscription.authorDid
              const isYou = inscription.authorDid === currentDid
              return (
                <RingItem
                  key={inscription.uri}
                  inscription={inscription}
                  index={actualIndex}
                  total={inscriptions.length}
                  handle={handle}
                  isYou={isYou}
                />
              )
            })}
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
        dangerouslySetInnerHTML={{ __html: ringImageOrientationScript }}
      />
      <script
        dangerouslySetInnerHTML={{ __html: mapScript }}
      />
    </Shell>
  )
}
