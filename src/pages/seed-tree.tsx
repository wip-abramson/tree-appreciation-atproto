import { imageResizeScript } from './client-scripts'
import { Shell } from './shell'

type Props = {
  user: { did: string; displayName?: string; handle?: string; avatarUrl?: string }
}

const seedScript = `
;(function () {
  var input = document.getElementById('image-input')
  var preview = document.getElementById('image-preview')
  var dropzone = document.getElementById('photo-dropzone')
  var latField = document.getElementById('latitude')
  var lngField = document.getElementById('longitude')
  var feedback = document.getElementById('gps-feedback')
  var hideCheckbox = document.getElementById('hide-location')
  var takenField = document.getElementById('photo-taken-at')
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
  L.Control.geocoder({
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

  // Click map to set location
  map.on('click', function (e) {
    if (hideCheckbox.checked) return
    latField.value = e.latlng.lat.toFixed(6)
    lngField.value = e.latlng.lng.toFixed(6)
    placeMarker(e.latlng.lat, e.latlng.lng, false)
    feedback.textContent = 'Location set from map.'
    feedback.className = 'gps-feedback gps-found'
  })

  // --- Photo upload + EXIF ---
  input.addEventListener('change', function () {
    var file = input.files[0]
    if (!file) {
      preview.style.display = 'none'
      dropzone.classList.remove('has-photo')
      feedback.textContent = ''
      return
    }

    var reader = new FileReader()
    reader.onload = function (e) {
      preview.src = e.target.result
      preview.style.display = 'block'
      dropzone.classList.add('has-photo')
    }
    reader.readAsDataURL(file)

    // Capture when the photo was taken (regardless of location privacy)
    if (typeof exifr !== 'undefined') {
      exifr
        .parse(file)
        .then(function (exif) {
          var raw = exif && exif.DateTimeOriginal
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            takenField.value = raw.toISOString()
          } else {
            takenField.value = ''
          }
        })
        .catch(function () {
          takenField.value = ''
        })
    }

    if (typeof exifr !== 'undefined' && !hideCheckbox.checked) {
      exifr
        .gps(file)
        .then(function (gps) {
          if (hideCheckbox.checked) return
          if (gps && typeof gps.latitude === 'number' && !isNaN(gps.latitude)
                  && typeof gps.longitude === 'number' && !isNaN(gps.longitude)) {
            latField.value = gps.latitude.toFixed(6)
            lngField.value = gps.longitude.toFixed(6)
            placeMarker(gps.latitude, gps.longitude, true)
            feedback.textContent = 'The photo remembers where it was taken.'
            feedback.className = 'gps-feedback gps-found'
          } else {
            feedback.textContent =
              'No location in this photo \\u2014 tap the map to place the tree, or leave it unplaced.'
            feedback.className = 'gps-feedback gps-not-found'
          }
        })
        .catch(function () {
          if (hideCheckbox.checked) return
          feedback.textContent =
            'No location in this photo \\u2014 tap the map to place the tree, or leave it unplaced.'
          feedback.className = 'gps-feedback gps-not-found'
        })
    }
  })

  // --- Client-side downscale before upload ---
  if (window.__attachImageResize) {
    window.__attachImageResize(document.querySelector('.tree-form'))
  }

  // --- Hide-location toggle ---
  hideCheckbox.addEventListener('change', function () {
    if (hideCheckbox.checked) {
      latField.value = ''
      lngField.value = ''
      mapEl.style.opacity = '0.4'
      mapEl.style.pointerEvents = 'none'
      removeMarker()
      feedback.textContent = ''
      feedback.className = 'gps-feedback'
    } else {
      mapEl.style.opacity = '1'
      mapEl.style.pointerEvents = ''
    }
  })
})()
`

export function SeedTree({ user }: Props) {
  return (
    <Shell
      title="Seed a Presence — Tree Appreciation"
      user={user}
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
          <h1>
            <a href="/">Tree Appreciation</a>
          </h1>
        </div>
        <div className="container">
          <form
            action="/tree"
            method="post"
            encType="multipart/form-data"
            className="seed-form"
          >
            <p className="seed-invitation">
              You're with a tree. A photo is enough.
            </p>

            <label id="photo-dropzone" className="photo-dropzone">
              <img id="image-preview" alt="" />
              <span className="photo-dropzone-prompt">Add a photo of the tree</span>
              <input
                type="file"
                id="image-input"
                name="image"
                accept="image/*"
                required
              />
            </label>

            <div id="gps-feedback" className="gps-feedback"></div>

            <input type="hidden" id="latitude" name="latitude" />
            <input type="hidden" id="longitude" name="longitude" />
            <input type="hidden" id="photo-taken-at" name="photoTakenAt" />

            <div id="seed-map" className="seed-map"></div>
            <label className="checkbox-label">
              <input type="checkbox" id="hide-location" name="hideLocation" />
              Keep the location private
            </label>

            <button type="submit">Seed this presence</button>
          </form>
        </div>
        <script dangerouslySetInnerHTML={{ __html: imageResizeScript }} />
        <script dangerouslySetInnerHTML={{ __html: seedScript }} />

      </div>
    </Shell>
  )
}
