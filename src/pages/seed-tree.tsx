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

  input.addEventListener('change', function () {
    var file = input.files[0]
    if (!file) {
      preview.style.display = 'none'
      feedback.textContent = ''
      return
    }

    // Show image preview
    var reader = new FileReader()
    reader.onload = function (e) {
      preview.src = e.target.result
      preview.style.display = 'block'
    }
    reader.readAsDataURL(file)

    // Extract EXIF GPS
    if (typeof exifr !== 'undefined') {
      exifr
        .gps(file)
        .then(function (gps) {
          if (gps && gps.latitude != null && gps.longitude != null) {
            latField.value = gps.latitude.toFixed(6)
            lngField.value = gps.longitude.toFixed(6)
            feedback.textContent =
              'GPS coordinates found in image and auto-filled.'
            feedback.className = 'gps-feedback gps-found'
          } else {
            feedback.textContent =
              'No GPS data found in image. Please enter coordinates manually.'
            feedback.className = 'gps-feedback gps-not-found'
          }
        })
        .catch(function () {
          feedback.textContent =
            'No GPS data found in image. Please enter coordinates manually.'
          feedback.className = 'gps-feedback gps-not-found'
        })
    }
  })
})()
`

export function SeedTree({ profile }: Props) {
  return (
    <Shell
      title="Seed a Tree — Tree Appreciation"
      headContent={
        <script src="https://cdn.jsdelivr.net/npm/exifr/dist/lite.umd.js"></script>
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
              <button type="submit">Seed this presence</button>
            </form>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: exifrScript }} />
      </div>
    </Shell>
  )
}
