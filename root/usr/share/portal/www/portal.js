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
        document.body.style.backgroundImage = 'url("' + d.background + '")';
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
