'use strict';
'require view';
'require form';
'require fs';
'require uci';
'require ui';
'require portal.common as common';

const ICON_DIR = '/etc/portal/www/icons';

const MIME = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
	svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp'
};

function extension(name) {
	return (name.split('.').pop() || '').toLowerCase();
}

return view.extend({
	/*
	 * The icon library has to be known before render(): ListValue candidates
	 * must be registered before the widget is built. A failure to list the
	 * directory (empty, or denied) just yields an empty picker.
	 */
	load: function() {
		return Promise.all([
			uci.load('portal'),
			fs.list(ICON_DIR).catch(function() { return []; })
		]).then(function(data) {
			this.icons = (data[1] || []).filter(function(entry) {
				return entry.type === 'file' && MIME[extension(entry.name)];
			}).map(function(entry) {
				return entry.name;
			});
		}.bind(this));
	},

	render: function() {
		return common.render_safe(function() {
			let m, s, o;

			m = new form.Map('portal', _('Bookmarks'),
				_('The tiles shown on the portal page. Only enabled bookmarks are baked ' +
				  'into links.json.'));

			s = m.section(form.TableSection, 'link', _('Bookmarks'));
			s.anonymous = true;
			s.addremove = true;

			o = s.option(form.Flag, 'enabled', _('Enabled'));
			o.default = '1';
			o.rmempty = false;

			const enabled = o;

			o = s.option(form.Value, 'name', _('Name'));
			o.rmempty = false;

			o = s.option(form.Value, 'url', _('URL'));
			o.rmempty = false;
			o.placeholder = 'http://192.168.1.1:3000';

			o = s.option(form.Value, 'icon_url', _('Icon'),
				_('An emoji or an absolute image URL.'));
			o.placeholder = '💡';

			/*
			 * A file from the Assets page. The value is stored as an absolute
			 * path, which the backend strips down to something the portal page
			 * can request. It wins over `icon_url` when both are set.
			 */
			o = s.option(form.ListValue, 'icon', _('Icon file'),
				_('An image from the Assets page. Takes precedence over the icon above.'));
			o.rmempty = true;
			o.optional = true;

			(this.icons || []).forEach(function(name) {
				o.value(ICON_DIR + '/' + name, name);
			});

			/*
			 * Tick every "Enabled" box at once.
			 *
			 * form.js has no select-all of its own - grepping it for
			 * selectAll/toggleAll/checkall finds nothing, and none of the views
			 * built on form.Flag carry one either. form.Button is no good here
			 * either: inside a TableSection it occupies a column of every row.
			 *
			 * The flag is driven through its own widget instance rather than by
			 * poking at the DOM. Map.parse() reads the value back with
			 * CBIFlagValue.formvalue(), which asks the ui.Checkbox whether it is
			 * checked, so setting it here is exactly what a user click does - and
			 * no synthetic change event is needed for the value to be picked up.
			 */
			const selectAll = E('button', {
				class: 'btn cbi-button cbi-button-action',
				click: function(ev) {
					ev.preventDefault();

					const sids = s.cfgsections();
					let count = 0;

					for (let i = 0; i < sids.length; i++) {
						const elem = enabled.getUIElement(sids[i]);

						if (elem == null)
							continue;

						elem.setValue(enabled.enabled);
						count++;
					}

					ui.addNotification(null, E('p', {},
						_('Enabled %d bookmark(s). Press "Save & Apply" to keep the change.')
							.format(count)), 'info');
				}
			}, _('Select all'));

			return m.render().then(function(mapNode) {
				/*
				 * form.Button renders a full table cell, so the button is placed
				 * above the map instead - same effect, no empty column.
				 */
				const wrapper = E('div', {}, [
					E('div', { style: 'margin-bottom:.5em' }, selectAll),
					mapNode
				]);

				return wrapper;
			});
		}.bind(this));
	}
});
