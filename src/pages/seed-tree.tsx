import { Shell } from './shell'

type Props = {
  profile: { displayName?: string }
}

const exifrScript = `
;(function () {
  var input = document.getElementById('image-input')
  var preview = document.getElementById('image-preview')
  var latField = document.getElementById('latitude')
  var lngField = document.getElementById('longitude')
  var feedback = document.getElementById('gps-feedback')
  var hideCheckbox = document.getElementById('hide-location')
  var locationRow = document.querySelector('.tree-form-row')
  var mapEl = document.getElementById('seed-map')

  // --- Map setup ---
  var DEFAULT_LAT = 20
  var DEFAULT_LNG = 0
  var DEFAULT_ZOOM = 2
  var PLACED_ZOOM = 15

  var map = L.map(mapEl).setView([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '\\u00a9 OpenStreetMap'
  }).addTo(map)

  // Search control
  var geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: 'Search for a place...',
    collapsed: false
  }).on('markgeocode', function (e) {
    if (hideCheckbox.checked) return
    var center = e.geocode.center
    latField.value = center.lat.toFixed(6)
    lngField.value = center.lng.toFixed(6)
    placeMarker(center.lat, center.lng, true)
    feedback.textContent = 'Location set from search.'
    feedback.className = 'gps-feedback gps-found'
  }).addTo(map)

  var marker = null

  function placeMarker(lat, lng, panTo) {
    if (marker) {
      marker.setLatLng([lat, lng])
    } else {
      marker = L.circleMarker([lat, lng], {
        radius: 8,
        fillColor: '#3a7d2a',
        color: '#265c1a',
        weight: 2,
        fillOpacity: 0.9
      }).addTo(map)
    }
    if (panTo) {
      map.setView([lat, lng], Math.max(map.getZoom(), PLACED_ZOOM))
    }
  }

  function removeMarker() {
    if (marker) {
      map.removeLayer(marker)
      marker = null
    }
  }

  function updateFromFields() {
    var lat = parseFloat(latField.value)
    var lng = parseFloat(lngField.value)
    if (!isNaN(lat) && !isNaN(lng)) {
      placeMarker(lat, lng, true)
    }
  }

  // Click map to set location
  map.on('click', function (e) {
    if (hideCheckbox.checked) return
    var lat = e.latlng.lat.toFixed(6)
    var lng = e.latlng.lng.toFixed(6)
    latField.value = lat
    lngField.value = lng
    placeMarker(e.latlng.lat, e.latlng.lng, false)
    feedback.textContent = 'Location set from map.'
    feedback.className = 'gps-feedback gps-found'
  })

  // Sync fields → map on manual edit
  latField.addEventListener('change', updateFromFields)
  lngField.addEventListener('change', updateFromFields)

  // --- Image upload + EXIF ---
  input.addEventListener('change', function () {
    var file = input.files[0]
    if (!file) {
      preview.style.display = 'none'
      feedback.textContent = ''
      return
    }

    var reader = new FileReader()
    reader.onload = function (e) {
      preview.src = e.target.result
      preview.style.display = 'block'
    }
    reader.readAsDataURL(file)

    if (typeof exifr !== 'undefined' && !hideCheckbox.checked) {
      exifr
        .gps(file)
        .then(function (gps) {
          if (hideCheckbox.checked) return
          if (gps && gps.latitude != null && gps.longitude != null) {
            latField.value = gps.latitude.toFixed(6)
            lngField.value = gps.longitude.toFixed(6)
            placeMarker(gps.latitude, gps.longitude, true)
            feedback.textContent =
              'GPS coordinates found in image and auto-filled.'
            feedback.className = 'gps-feedback gps-found'
          } else {
            feedback.textContent =
              'No GPS data found in image. You can click the map or enter coordinates.'
            feedback.className = 'gps-feedback gps-not-found'
          }
        })
        .catch(function () {
          if (hideCheckbox.checked) return
          feedback.textContent =
            'No GPS data found in image. You can click the map or enter coordinates.'
          feedback.className = 'gps-feedback gps-not-found'
        })
    }
  })

  // --- Hide-location toggle ---
  hideCheckbox.addEventListener('change', function () {
    if (hideCheckbox.checked) {
      latField.value = ''
      lngField.value = ''
      latField.disabled = true
      lngField.disabled = true
      locationRow.style.opacity = '0.4'
      mapEl.style.opacity = '0.4'
      mapEl.style.pointerEvents = 'none'
      removeMarker()
      feedback.textContent = ''
      feedback.className = 'gps-feedback'
    } else {
      latField.disabled = false
      lngField.disabled = false
      locationRow.style.opacity = '1'
      mapEl.style.opacity = '1'
      mapEl.style.pointerEvents = ''
    }
  })
})()
`

export function SeedTree({ profile }: Props) {
  return (
    <Shell
      title="Seed a Tree — Tree Appreciation"
      headContent={
        <>
          <script src="https://cdn.jsdelivr.net/npm/exifr/dist/lite.umd.js"></script>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <link rel="stylesheet" href="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.css" />
          <script src="https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.min.js"></script>
        </>
      }
    >
      <div id="root">
        <div id="header">
          <h1>Tree Appreciation</h1>
          <p>
            <a href="/">Back to all trees</a>
          </p>
        </div>
        <div className="container">
          <div className="card">
            <h2>Seed Tree Presence</h2>
            <form
              action="/tree"
              method="post"
              encType="multipart/form-data"
              className="tree-form"
            >
              <label>
                Name
                <input
                  type="text"
                  name="name"
                  placeholder="e.g. The Old Oak on Elm Street"
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Description (optional)
                <textarea
                  name="description"
                  placeholder="What makes this tree special?"
                  maxLength={1000}
                  rows={3}
                ></textarea>
              </label>
              <label>
                URL slug (optional)
                <input
                  type="text"
                  name="slug"
                  placeholder="e.g. old-oak-on-elm-street"
                  maxLength={200}
                />
                <span className="form-hint">
                  Auto-generates from the name if left blank.
                </span>
              </label>
              <label>
                Photo (JPEG or PNG, required)
                <input
                  type="file"
                  id="image-input"
                  name="image"
                  accept="image/jpeg,image/png"
                  required
                />
              </label>
              <img id="image-preview" alt="Preview" />
              <p className="form-hint">
                If your photo has GPS data, coordinates will be extracted
                automatically.
              </p>
              <div id="gps-feedback" className="gps-feedback"></div>
              <label className="checkbox-label">
                <input type="checkbox" id="hide-location" name="hideLocation" />
                Don't share location
              </label>
              <div className="tree-form-row">
                <label>
                  Latitude
                  <input
                    type="text"
                    id="latitude"
                    name="latitude"
                    placeholder="e.g. 40.7128"
                  />
                </label>
                <label>
                  Longitude
                  <input
                    type="text"
                    id="longitude"
                    name="longitude"
                    placeholder="e.g. -74.0060"
                  />
                </label>
              </div>
              <div id="seed-map" className="seed-map"></div>
              <p className="form-hint">Click the map to set or adjust the location.</p>
              <button type="submit">Seed this presence</button>
            </form>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: exifrScript }} />
      </div>
    </Shell>
  )
}
