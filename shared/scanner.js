/* Camera QR scanner.
   1st choice: the phone's built-in QR detector (BarcodeDetector, e.g. Android Chrome).
   2nd choice: the jsQR library (needed on iPhone). It is loaded from lib/jsQR.js if present,
   otherwise from the internet once and then kept offline by the service worker. */
var Scanner = (function () {
  var JSQR_CDN = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  var stream = null, timer = null, running = false;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function getDecoder() {
    if ('BarcodeDetector' in window) {
      return BarcodeDetector.getSupportedFormats().then(function (formats) {
        if (formats.indexOf('qr_code') >= 0) {
          var det = new BarcodeDetector({ formats: ['qr_code'] });
          return function (video) {
            return det.detect(video).then(function (codes) { return codes.length ? codes[0].rawValue : null; });
          };
        }
        return jsqrDecoder();
      }).catch(jsqrDecoder);
    }
    return jsqrDecoder();
  }

  function jsqrDecoder() {
    var ready = window.jsQR ? Promise.resolve() :
      loadScript('../shared/jsQR.js').catch(function () { return loadScript(JSQR_CDN); });
    return ready.then(function () {
      if (!window.jsQR) throw new Error('QR reader not available');
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      return function (video) {
        var w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return Promise.resolve(null);
        var scale = Math.min(1, 640 / Math.max(w, h));
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        return Promise.resolve(code ? code.data : null);
      };
    });
  }

  // Start the camera inside <video>. Calls onCode(text) once, then stops.
  function start(video, onCode, onError) {
    stop();
    running = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onError('This browser cannot open the camera here. The app must be opened from an https:// link. Use "Choose from list" instead.');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then(function (s) {
        if (!running) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s;
        video.srcObject = s;
        video.setAttribute('playsinline', '');
        video.muted = true;
        return video.play().then(getDecoder).then(function (decode) {
          function tick() {
            if (!running) return;
            decode(video).then(function (text) {
              if (!running) return;
              if (text) { stop(); onCode(text); }
              else timer = setTimeout(tick, 150);
            }).catch(function () { timer = setTimeout(tick, 300); });
          }
          tick();
        });
      })
      .catch(function (err) {
        stop();
        var msg = (err && err.name === 'NotAllowedError')
          ? 'Camera permission was refused. Allow camera access in the browser settings, or use "Choose from list".'
          : 'Could not start the QR scanner (' + (err && err.message ? err.message : err) + '). Use "Choose from list".';
        onError(msg);
      });
  }

  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  return { start: start, stop: stop, JSQR_CDN: JSQR_CDN };
})();
