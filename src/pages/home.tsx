import type { Tree } from '#/db'
import { imageUrl, treeLabel } from '#/lib/util'
import { Shell } from './shell'

type Props = {
  trees: Tree[]
  /** uri -> chronological photo srcs, present only when a tree has 2+ moments */
  frames: Record<string, string[]>
  user?: { did: string; displayName?: string; handle?: string; avatarUrl?: string }
}

const groveScript = `
(function() {
  var grid = document.getElementById('grove-grid');
  var orientBtn = document.getElementById('orient-btn');
  var status = document.getElementById('orient-status');
  if (!grid) return;

  var canHover = window.matchMedia('(hover: hover)').matches;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.grove-card'));

  function announce(msg) { if (status) status.textContent = msg; }

  // --- Graceful image fallback: a failed photo settles into a quiet placeholder ---
  Array.prototype.forEach.call(grid.querySelectorAll('.grove-card-image'), function(img) {
    function fail() {
      var media = img.closest('.grove-card-media');
      if (media) media.classList.add('is-imageless');
      if (img.parentNode) img.parentNode.removeChild(img);
    }
    if (img.complete && img.naturalWidth === 0) fail();
    else img.addEventListener('error', fail);
  });

  // --- Timelapse: a tree's moments crossfade like memory rings ---
  function setupLapse(card) {
    var raw = card.getAttribute('data-frames');
    if (!raw) return null;
    var srcs;
    try { srcs = JSON.parse(raw); } catch (e) { return null; }
    if (!srcs || srcs.length < 2) return null;
    var media = card.querySelector('.grove-card-media');
    if (!media) return null;

    var built = false, frames = [], idx = 0, timer = null;
    function build() {
      if (built) return;
      built = true;
      srcs.forEach(function(src) {
        var img = document.createElement('img');
        img.className = 'grove-card-frame';
        img.src = src;
        img.alt = '';
        media.appendChild(img);
        frames.push(img);
      });
    }
    function show(i) {
      idx = i;
      frames.forEach(function(f, n) { f.classList.toggle('is-active', n === i); });
    }
    return {
      start: function(interval) {
        build();
        show(0);
        card.classList.add('is-lapsing');
        clearInterval(timer);
        timer = setInterval(function() { show((idx + 1) % frames.length); }, interval);
      },
      stop: function() {
        clearInterval(timer);
        timer = null;
        card.classList.remove('is-lapsing');
      }
    };
  }

  if (!reduce && !saveData) {
    if (canHover) {
      // Pointer devices: a tree's moments unfold while you rest on it.
      cards.forEach(function(card) {
        var lapse = setupLapse(card);
        if (!lapse) return;
        card.addEventListener('mouseenter', function() { lapse.start(1150); });
        card.addEventListener('mouseleave', function() { lapse.stop(); });
      });
    } else if ('IntersectionObserver' in window) {
      // Touch devices: moments unfold slowly while the card rests in view.
      var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          var lapse = entry.target.__lapse;
          if (!lapse) return;
          if (entry.isIntersecting) lapse.start(2600);
          else lapse.stop();
        });
      }, { threshold: 0.6 });
      cards.forEach(function(card) {
        var lapse = setupLapse(card);
        if (!lapse) return;
        card.__lapse = lapse;
        io.observe(card);
      });
    }
  }

  // --- Orient by the trees near you (distance sort — toggles back to the grove) ---
  var originalOrder = cards.slice();
  var oriented = false;

  function distanceKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(km) {
    if (km < 1) return Math.round(km * 1000) + ' m away';
    if (km < 10) return km.toFixed(1) + ' km away';
    return Math.round(km) + ' km away';
  }

  function applyOrient(position) {
    var here = [position.coords.latitude, position.coords.longitude];
    cards.forEach(function(card) {
      var lat = parseFloat(card.dataset.lat);
      var lng = parseFloat(card.dataset.lng);
      if (isNaN(lat) || isNaN(lng)) {
        card.dataset.km = '';
        return;
      }
      var km = distanceKm(here[0], here[1], lat, lng);
      card.dataset.km = km;
      var label = card.querySelector('.grove-card-distance');
      if (!label) {
        label = document.createElement('span');
        label.className = 'grove-card-distance';
        card.appendChild(label);
      }
      label.textContent = formatDistance(km);
    });
    var sorted = cards.slice().sort(function(a, b) {
      if (a.dataset.km === '') return 1;
      if (b.dataset.km === '') return -1;
      return parseFloat(a.dataset.km) - parseFloat(b.dataset.km);
    });
    sorted.forEach(function(card) { grid.appendChild(card); });
    grid.classList.add('is-oriented');
    oriented = true;
    if (orientBtn) {
      orientBtn.querySelector('.orient-label').textContent = 'shuffle the grove';
      orientBtn.classList.add('is-oriented');
    }
    announce('The grove is sorted by the trees nearest you.');
  }

  function restore() {
    originalOrder.forEach(function(card) { grid.appendChild(card); });
    grid.classList.remove('is-oriented');
    oriented = false;
    if (orientBtn) {
      orientBtn.querySelector('.orient-label').textContent = 'find the trees near you';
      orientBtn.classList.remove('is-oriented');
    }
    announce('The grove has returned to its wandering order.');
  }

  if (orientBtn) {
    if (!('geolocation' in navigator)) {
      orientBtn.style.display = 'none';
    } else {
      orientBtn.addEventListener('click', function() {
        if (oriented) { restore(); return; }
        orientBtn.querySelector('.orient-label').textContent = 'finding you…';
        navigator.geolocation.getCurrentPosition(applyOrient, function() {
          orientBtn.querySelector('.orient-label').textContent = 'find the trees near you';
          announce('We could not find your location.');
        });
      });
    }
  }
})();
`

const headContent = (
  <>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;1,6..72,300;1,6..72,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"
      rel="stylesheet"
    />
  </>
)

/** Concentric rings — a quiet mark that a tree carries more than one moment. */
function RingsMark() {
  return (
    <span className="grove-rings" role="img" aria-label="This tree carries several moments">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <title>This tree carries several moments</title>
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="9.5" />
      </svg>
    </span>
  )
}

export function Home({ trees, frames, user }: Props) {
  return (
    <Shell title="Tree Appreciation" user={user} headContent={headContent}>
      <div id="root">
        <div id="header">
          <h1>Tree Appreciation</h1>
          <p className="tagline">A living record of the trees around us.</p>
        </div>

        <div className="grove">
          {trees.length === 0 ? (
            <p className="empty-state">
              No presences yet. The grove is waiting for its first tree.
            </p>
          ) : (
            <>
              <div className="grove-intro">
                <button type="button" id="orient-btn" className="orient-btn">
                  <span className="orient-mark" aria-hidden="true">
                    ✦
                  </span>
                  <span className="orient-label">find the trees near you</span>
                </button>
                <p id="orient-status" className="sr-only" role="status" aria-live="polite"></p>
              </div>

              <div id="grove-grid" className="grove-grid">
                {trees.map((tree) => {
                  const label = treeLabel(tree)
                  const treeFrames = frames[tree.uri]
                  return (
                    <a
                      key={tree.uri}
                      href={`/tree/${tree.slug}`}
                      className="grove-card"
                      data-lat={tree.latitude ?? undefined}
                      data-lng={tree.longitude ?? undefined}
                      data-frames={treeFrames ? JSON.stringify(treeFrames) : undefined}
                    >
                      <div className="grove-card-media">
                        {tree.imageCid ? (
                          <img
                            className="grove-card-image"
                            src={imageUrl(tree.authorDid, tree.imageCid)}
                            alt={label ?? 'A tree'}
                            loading="lazy"
                          />
                        ) : (
                          <div className="grove-card-placeholder"></div>
                        )}
                      </div>
                      {treeFrames ? <RingsMark /> : null}
                      {label ? <span className="grove-card-place">{label}</span> : null}
                    </a>
                  )
                })}
              </div>
            </>
          )}

          <p className="grove-foot">
            {user ? (
              <>
                Know a tree? <a href="/seed-tree">Seed its presence.</a>
              </>
            ) : (
              <>
                Know a tree? <a href="/login">Log in</a> to seed its presence.
              </>
            )}
          </p>
        </div>

        <script dangerouslySetInnerHTML={{ __html: groveScript }} />
      </div>
    </Shell>
  )
}
