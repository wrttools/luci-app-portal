'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';

/*
 * Backend: /usr/share/rpcd/ucode/portal.uc, exposed as the `luci.portal` ubus
 * object. Access is granted by /usr/share/rpcd/acl.d/luci-app-portal.json.
 */
const callScan = rpc.declare({
	object: 'luci.portal',
	method: 'scan',
	params: [ 'ports' ]
});

const callGenerate = rpc.declare({
	object: 'luci.portal',
	method: 'generate'
});

/*
 * Refuse ports that the main uhttpd instance already listens on. The uhttpd
 * configuration is read client side, so it is also listed in the read ACL.
 */
function port_in_use(port) {
	let in_use = false;

	try {
		uci.sections('uhttpd', 'uhttpd').forEach(function(instance) {
			[ instance.listen_http, instance.listen_https ].forEach(function(listen) {
				const match = /:([0-9]+)$/.exec(listen || '');

				if (match && +match[1] === port)
					in_use = true;
			});
		});
	}
	catch (e) {
		/* uhttpd configuration unavailable - nothing to clash with */
	}

	return in_use;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('portal'),
			uci.load('uhttpd')
		]);
	},

	render: function() {
		let m, s, o;

		m = new form.Map('portal', _('Portal'),
			_('A static HTML portal served by its own uhttpd instance on a dedicated ' +
			  'port. Settings are persisted in uci and baked into links.json on apply.'));

		/* --------------------------------------------------------- General -- */

		s = m.section(form.TypedSection, 'portal', _('General'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'port', _('Listen port'));
		o.datatype = 'port';
		o.default = '8180';
		o.rmempty = false;
		o.validate = function(section_id, value) {
			const port = +value;

			if (port === 80 || port === 8080)
				return _('Ports 80 and 8080 are reserved by the main web server.');

			if (port_in_use(port))
				return _('This port is already used by the main uhttpd instance.');

			return true;
		};

		o = s.option(form.Value, 'title', _('Page title'));
		o.placeholder = 'My Portal';

		o = s.option(form.Value, 'background', _('Background colour'),
			_('A CSS colour value such as #0e1116.'));
		o.placeholder = '#0e1116';

		o = s.option(form.FileUpload, 'background_file', _('Background image'),
			_('Uploaded to /etc/portal/www/bg, takes precedence over the colour.'));
		o.root_directory = '/etc/portal/www/bg';
		o.enable_remove = true;
		o.enable_download = false;

		/* ------------------------------------------------------- Bookmarks -- */

		s = m.section(form.TableSection, 'link', _('Bookmarks'));
		s.anonymous = true;
		s.addremove = true;

		o = s.option(form.Flag, 'enabled', _('Enabled'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('Name'));
		o.rmempty = false;

		o = s.option(form.Value, 'url', _('URL'));
		o.rmempty = false;
		o.placeholder = 'http://192.168.1.1:3000';

		o = s.option(form.Value, 'icon_url', _('Icon'),
			_('An emoji or an absolute image URL.'));
		o.placeholder = '💡';

		o = s.option(form.FileUpload, 'icon', _('Icon file'),
			_('Uploaded to /etc/portal/www/icons.'));
		o.root_directory = '/etc/portal/www/icons';
		o.enable_remove = true;
		o.enable_download = false;

		/* ----------------------------------------------------- Maintenance -- */

		s = m.section(form.TypedSection, 'portal', _('Maintenance'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Button, '_generate', _('Static page'));
		o.inputtitle = _('Regenerate links.json now');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return callGenerate().then(function(result) {
				ui.addNotification(null, E('p', {}, _('Regenerated: %d bookmark(s).')
					.format((result && result.links) || 0)), 'info');
			});
		};

		o = s.option(form.Button, '_scan', _('Discovery'));
		o.inputtitle = _('Scan local services & add (disabled)');
		o.inputstyle = 'action';
		o.onclick = function() {
			return callScan().then(function(result) {
				const entries = (result && result.ports) || [];
				const host = (result && result.lan_ip) || window.location.hostname;
				let added = 0;

				entries.forEach(function(entry) {
					const url = 'http://' + host + ':' + entry.port;

					const known = uci.sections('portal', 'link').some(function(section) {
						return uci.get('portal', section['.name'], 'url') === url;
					});

					if (known)
						return;

					const sid = uci.add('portal', 'link');

					uci.set('portal', sid, 'name', entry.svc || _('Service %d').format(entry.port));
					uci.set('portal', sid, 'url', url);
					uci.set('portal', sid, 'icon_url', '🔌');
					uci.set('portal', sid, 'enabled', '0');
					added++;
				});

				if (!added) {
					ui.addNotification(null, E('p', {}, _('No new local services found.')), 'info');
					return;
				}

				ui.addNotification(null, E('p', {},
					_('Added %d disabled bookmark(s) - tick the ones you want and apply.')
						.format(added)), 'info');

				return uci.save().then(function() {
					window.location.reload();
				});
			});
		};

		return m.render();
	}
});
