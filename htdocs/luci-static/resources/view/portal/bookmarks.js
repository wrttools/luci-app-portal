'use strict';
'require view';
'require form';
'require fs';
'require request';
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

/*
 * Write the staged values into /etc/config and commit them.
 *
 * uci.save() alone is not enough. It writes the configuration file, but only the
 * commit fires the procd reload trigger registered for the portal configuration,
 * and that reload is what runs generate(). generate() runs in the rpcd plugin
 * process with its own uci cursor, so it never sees this session's staged
 * changes - without a commit it would re-bake the previous values and the portal
 * page would keep showing them.
 *
 * The commit goes through the HTTP endpoint the footer's "Save & Apply" uses,
 * not through ubus `uci apply`: that method is checked against an ACL that is not
 * scoped to a single configuration, so a session holding write access to just
 * `portal` cannot call it and gets ubus code 6, permission denied. The endpoint
 * commits every pending configuration one by one with the caller's session,
 * which is exactly the permission this page does have - and it is the path the
 * LuCI UI itself takes, so this cannot diverge from "Save & Apply" behaviour.
 */
function commit() {
	return uci.save().then(function() {
		return request.request(L.url('admin/uci', 'apply_unchecked'), {
			method: 'post',
			query: { sid: L.env.sessionid, token: L.env.token }
		});
	}).then(function(res) {
		/*
		 * 204 is the controller's success status; anything else is mapped from the
		 * underlying ubus status (403 permission denied, 400 invalid argument...),
		 * which says far more than a generic failure would.
		 */
		if (res == null || res.status !== 204)
			throw new Error('apply_unchecked failed: HTTP ' + (res ? res.status : '?'));

		return res;
	});
}

/*
 * Save a single row.
 *
 * The same walk as form.TableSection#parse() - including the per-option
 * validation, so that an empty name or URL is reported instead of written - but
 * limited to one section id. That is the whole point of the button: the footer
 * "Save & Apply" parses every row, so one unfinished row anywhere in the table
 * would block the save of an unrelated one, and it re-renders the page as well.
 */
function save_row(section, section_id) {
	const tasks = (section.children || []).filter(function(opt) {
		return opt.editable && !opt.modalonly;
	}).map(function(opt) {
		return opt.parse(section_id);
	});

	return Promise.all(tasks).then(commit);
}

/* ---------------------------------------------------------------- the table -- */

const BookmarkTable = form.TableSection.extend({
	/*
	 * The per-row "Save" button, placed left of LuCI's "Delete". It commits this
	 * row only - the other rows, including a half filled one that has not been
	 * saved yet, are left alone.
	 */
	renderRowActions(section_id, more_label, trEl) {
		const node = this.super('renderRowActions', [ section_id, more_label, trEl ]);
		const remove = node.querySelector('button.cbi-button-remove');

		if (remove == null || this.map.readonly)
			return node;

		const section = this;

		const save = E('button', {
			title: _('Save this bookmark'),
			class: 'btn cbi-button cbi-button-save',
			click: function(ev) {
				ev.preventDefault();

				return common.run_rpc(function() {
					return save_row(section, section_id);
				}, _('Bookmark saved.'));
			}
		}, [ _('Save') ]);

		remove.parentNode.insertBefore(save, remove);

		return node;
	}
});

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

			s = m.section(BookmarkTable, 'link', _('Bookmarks'));
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
