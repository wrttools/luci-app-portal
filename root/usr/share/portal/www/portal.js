/*
 * Turn the appearance percentages from links.json - the very values the LuCI
 * sliders write - into the custom properties portal.css consumes. They go on
 * <html> rather than into inline styles because the scrim and the photo are
 * pseudo-elements, and an inline style on body cannot reach either of them.
 *
 * A value that is missing or unparsable falls back to what the stylesheet
 * hard-coded before these options existed, so an upgraded portal whose uci has
 * none of them renders exactly as it did before.
 */
function clamp(value, lo, hi, fallback) {
  var n = parseFloat(value);

  if (isNaN(n))
    return fallback;

  return Math.min(hi, Math.max(lo, n));
}

function apply_appearance(d) {
  var root = document.documentElement.style;
  var blur = clamp(d.bg_blur, 0, 100, 0);

  root.setProperty('--bg-veil', String(clamp(d.bg_veil, 0, 100, 78) / 100));

  /* Percent of the maximum (20px), so the slider and the CSS share one scale. */
  root.setProperty('--bg-blur', (blur * 0.2).toFixed(1) + 'px');

  /* The slider is labelled "transparency", the alpha channel is opacity. */
  root.setProperty('--card-alpha',
    String((100 - clamp(d.card_transparency, 0, 100, 45)) / 100));
}

fetch('links.json')
  .then(function (r) {
    /*
     * A 404 is not a fetch error - fetch() resolves it and r.json() then
     * chokes on the HTML error page the server answered with, so both end
     * up in the same catch(). Reporting the status here is what tells an
     * unwritten links.json ("HTTP 404") apart from a malformed one.
     */
    if (!r.ok)
      throw new Error('HTTP ' + r.status);

    return r.json();
  })
  .then(function (d) {
    apply_appearance(d);

    if (d.title) {
      document.getElementById('title').textContent = d.title;
      document.title = d.title;
    }
    if (d.background) {
      if (/^#|^rgb/.test(d.background)) {
        document.body.style.background = d.background;
      } else {
        /*
         * The path comes out of the backend rooted ("/bg/x.jpg"). Without the
         * leading slash the browser would resolve it against the page's own
         * path, which is not what the document root means.
         */
        var url = d.background.replace(/^([^\/])/, '/$1');

        /*
         * Replacing the background leaves the name untouched, so the browser
         * would serve the cached copy and a plain reload would keep showing
         * the old image. The version the backend reports (modification time
         * plus size) makes the URL change whenever the file does.
         */
        if (d.background_v)
          url += '?v=' + encodeURIComponent(d.background_v);

        /*
         * The photo lives on the pseudo-element that also carries the blur, so
         * a custom property is the only way to point at it: body itself has to
         * stay unblurred for the text on top to remain crisp. The colour set
         * above stays as the fallback layer, which is why nothing is cleared
         * when the image fails to load.
         */
        document.documentElement.style.setProperty('--bg-image', 'url("' + url + '")');
      }
    }
    var grid = document.getElementById('grid');
    (d.links || []).forEach(function (l) {
      if (!l.url) return;
      var a = document.createElement('a');
      a.className = 'card';
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener';

      var ico = document.createElement('div');
      ico.className = 'ico';
      if (l.icon) {
        if (/^https?:\/\//.test(l.icon) || l.icon.indexOf('/') >= 0) {
          var img = document.createElement('img');
          img.src = l.icon;
          ico.appendChild(img);
        } else {
          ico.textContent = l.icon;
        }
      }

      var nm = document.createElement('div');
      nm.className = 'name';
      nm.textContent = l.name || l.url;

      a.appendChild(ico);
      a.appendChild(nm);
      grid.appendChild(a);
    });
  })
  .catch(function (err) {
    document.getElementById('grid').textContent =
      'Failed to load links.json: ' + ((err && err.message) || err);
  });
