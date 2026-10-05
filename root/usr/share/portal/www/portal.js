fetch('links.json')
  .then(function (r) { return r.json(); })
  .then(function (d) {
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
         * Only background-image is set. The stylesheet's background shorthand
         * already provides the position, size and repeat the picture needs, and
         * its dark background-color is deliberately left in place as a
         * fallback: the page text is light, so a failed image load would
         * otherwise leave white-on-white.
         */
        document.body.style.backgroundImage = 'url("' + url + '")';
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
  .catch(function () {
    document.getElementById('grid').textContent = 'Failed to load links.json';
  });
