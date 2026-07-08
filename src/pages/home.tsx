import type { Tree } from '#/db'
import { imageUrl, treeLabel } from '#/lib/util'
import { Shell } from './shell'

type Props = {
  trees: Tree[]
  user?: { did: string; displayName?: string; handle?: string; avatarUrl?: string }
}

const groveScript = `
(function() {
  var mapEl = document.getElementById('grove-map');
  var grid = document.getElementById('grove-grid');
  var orientBtn = document.getElementById('orient-btn');
  var presences = mapEl ? JSON.parse(mapEl.dataset.presences || '[]') : [];

  // --- Map of presences ---
  var map = null;
  if (mapEl && presences.length > 0) {
    map = L.map(mapEl, { scrollWheelZoom: false }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '\\u00a9 OpenStreetMap'
    }).addTo(map);
    var bounds = [];
    presences.forEach(function(p) {
      var marker = L.circleMarker([p.lat, p.lng], {
        radius: 7,
        fillColor: '#3a7d2a',
        color: '#265c1a',
        weight: 2,
        fillOpacity: 0.85
      }).addTo(map);
      // Build with DOM APIs — labels are user-published data, never markup
      var popup = document.createElement('a');
      popup.className = 'grove-map-popup';
      popup.href = '/tree/' + encodeURIComponent(p.slug);
      if (p.img) {
        var img = document.createElement('img');
        img.src = p.img;
        img.alt = '';
        popup.appendChild(img);
      }
      var span = document.createElement('span');
      span.textContent = p.label || 'visit this presence';
      popup.appendChild(span);
      marker.bindPopup(popup);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length === 1) {
      map.setView(bounds[0], 13);
    } else {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  } else if (mapEl) {
    mapEl.style.display = 'none';
  }

  // --- Orient by the trees around you ---
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

  function orient(position) {
    var here = [position.coords.latitude, position.coords.longitude];

    // Sort the grove by nearness; trees without a location drift to the end
    if (grid) {
      var cards = Array.prototype.slice.call(grid.children);
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
      cards.sort(function(a, b) {
        if (a.dataset.km === '') return 1;
        if (b.dataset.km === '') return -1;
        return parseFloat(a.dataset.km) - parseFloat(b.dataset.km);
      });
      cards.forEach(function(card) { grid.appendChild(card); });
    }

    // Settle the map around you
    if (map) {
      L.circleMarker(here, {
        radius: 6,
        fillColor: '#4a6fa5',
        color: '#2c4a7c',
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map).bindPopup('you are here');
      map.setView(here, 14);
    }

    if (orientBtn) {
      orientBtn.textContent = 'oriented by the trees around you';
      orientBtn.disabled = true;
    }
  }

  if (orientBtn) {
    if (!('geolocation' in navigator)) {
      orientBtn.style.display = 'none';
    } else {
      orientBtn.addEventListener('click', function() {
        orientBtn.textContent = 'finding you\\u2026';
        navigator.geolocation.getCurrentPosition(orient, function() {
          orientBtn.textContent = 'find the trees around you';
        });
      });
    }
  }
})();
`

export function Home({ trees, user }: Props) {
  const presences = trees
    .filter((t) => t.latitude && t.longitude)
    .map((t) => ({
      lat: Number(t.latitude),
      lng: Number(t.longitude),
      slug: t.slug,
      label: treeLabel(t),
      img: t.imageCid ? imageUrl(t.authorDid, t.imageCid) : null,
    }))

  return (
    <Shell
      title="Tree Appreciation"
      user={user}
      headContent={
        <>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        </>
      }
    >
      <div id="root">
        <div id="header">
          <h1>Tree Appreciation</h1>
          <p className="tagline">Create lasting presences for the trees around you.</p>
        </div>
        <div className="grove">
          {trees.length > 0 ? (
            <div className="orient-row">
              <button type="button" id="orient-btn" className="orient-btn">
                find the trees around you
              </button>
            </div>
          ) : null}

          {trees.length === 0 ? (
            <p className="empty-state">
              No presences yet. The grove is waiting for its first tree.
            </p>
          ) : (
            <div id="grove-grid" className="grove-grid">
              {trees.map((tree) => {
                const label = treeLabel(tree)
                return (
                  <a
                    key={tree.uri}
                    href={`/tree/${tree.slug}`}
                    className="grove-card"
                    data-lat={tree.latitude ?? undefined}
                    data-lng={tree.longitude ?? undefined}
                  >
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
                    {label ? <span className="grove-card-place">{label}</span> : null}
                  </a>
                )
              })}
            </div>
          )}

          {presences.length > 0 ? (
            <div
              id="grove-map"
              className="grove-map"
              data-presences={JSON.stringify(presences)}
            ></div>
          ) : null}

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
