/**
 * Client-side image downscaling, shared by the tree and inscription forms.
 *
 * Phone photos are frequently 8–15 MB. Uploading the full original to our
 * server (which then re-uploads a ~1 MB version to the PDS) is the dominant
 * cost of a slow upload on mobile. This resizes the image in the browser
 * before submit — typically a 5–10x reduction in bytes on the wire — while
 * degrading gracefully to the original file if anything is unsupported.
 *
 * EXIF-derived data (GPS, capture time) is already extracted into form fields
 * by the per-page change handlers before submit, so it is safe for the canvas
 * re-encode to drop EXIF here.
 *
 * Exposes `window.__attachImageResize(formElement)`.
 */
export const imageResizeScript = `
(function () {
  var MAX_DIM = 2048
  var QUALITY = 0.82
  // Below this size, downscaling isn't worth the effort/quality loss.
  var SKIP_BELOW_BYTES = 1500000

  function resizeFile(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\\//.test(file.type)) return resolve(file)
      if (typeof createImageBitmap !== 'function' || typeof DataTransfer === 'undefined') {
        return resolve(file)
      }

      var bitmapPromise = createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(file) })

      bitmapPromise
        .then(function (bmp) {
          var w = bmp.width
          var h = bmp.height
          var scale = Math.min(1, MAX_DIM / Math.max(w, h))

          if (scale === 1 && file.size < SKIP_BELOW_BYTES) {
            if (bmp.close) bmp.close()
            return resolve(file)
          }

          var cw = Math.max(1, Math.round(w * scale))
          var ch = Math.max(1, Math.round(h * scale))
          var canvas = document.createElement('canvas')
          canvas.width = cw
          canvas.height = ch
          var ctx = canvas.getContext('2d')
          if (!ctx) {
            if (bmp.close) bmp.close()
            return resolve(file)
          }
          ctx.drawImage(bmp, 0, 0, cw, ch)
          if (bmp.close) bmp.close()

          canvas.toBlob(
            function (blob) {
              if (!blob) return resolve(file)
              var base = (file.name || 'photo').replace(/\\.[^.]+$/, '')
              try {
                resolve(new File([blob], base + '.jpg', { type: 'image/jpeg' }))
              } catch (e) {
                resolve(file)
              }
            },
            'image/jpeg',
            QUALITY,
          )
        })
        .catch(function () {
          resolve(file)
        })
    })
  }

  window.__attachImageResize = function (form) {
    if (!form) return
    var input = form.querySelector('input[type="file"]')
    if (!input) return
    var resubmitting = false

    form.addEventListener('submit', function (e) {
      if (resubmitting) return
      // Let the browser run native validation first (form.submit() below skips it).
      if (form.checkValidity && !form.checkValidity()) return
      if (!input.files || !input.files[0]) return

      e.preventDefault()

      var btn = form.querySelector('button[type="submit"], button:not([type])')
      var btnText
      if (btn) {
        btnText = btn.textContent
        btn.disabled = true
        btn.textContent = 'Uploading\\u2026'
      }

      resizeFile(input.files[0])
        .then(function (newFile) {
          if (newFile !== input.files[0]) {
            try {
              var dt = new DataTransfer()
              dt.items.add(newFile)
              input.files = dt.files
            } catch (err) {
              /* keep the original file */
            }
          }
          resubmitting = true
          form.submit()
        })
        .catch(function () {
          resubmitting = true
          if (btn) {
            btn.disabled = false
            btn.textContent = btnText
          }
          form.submit()
        })
    })
  }
})()
`
