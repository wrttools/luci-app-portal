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

const callStatus = rpc.declare({
	object: 'luci.portal',
	method: 'status'
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

/* ------------------------------------------------------ service status -- */

function badge(text, ok) {
	return E('span', {
		style: 'display:inline-block;padding:1px 8px;border-radius:9px;color:#fff;' +
			'font-size:90%;white-space:nowrap;background:' + (ok ? '#2e7d32' : '#c62828')
	}, text);
}

function status_row(label, value) {
	return E('tr', { class: 'tr' }, [
		E('td', { class: 'td left', style: 'width:32%' }, label),
		E('td', { class: 'td left' }, value)
	]);
}

/*
 * A missing listener is the interesting case: procd keeps restarting a daemon
 * that dies immediately, so "running" alone would be misleading.
 */
function status_view(st) {
	if (!st)
		return [ E('em', {}, _('Service state unknown.')) ];

	const nodes = [
		E('table', { class: 'table' }, [
			status_row(_('Service'), [
				badge(st.running ? _('Running') : _('Stopped'), st.running),
				st.running && st.pid ? ' ' + _('PID %d').format(st.pid) : ''
			]),
			status_row(_('Listening'), [
				badge(st.listening ? _('Yes') : _('No'), st.listening),
				st.listening ? '' : ' ' + _('nothing is bound to port %d').format(st.port)
			]),
			status_row(_('Port'), String(st.port)),
			status_row(_('Address'), st.url
				? E('a', { href: st.url, target: '_blank', rel: 'noopener' }, st.url)
				: E('em', {}, _('unknown'))),
			status_row(_('Bookmarks'), st.generated
				? _('%d baked into links.json').format(st.links)
				: E('em', {}, _('links.json has not been generated yet')))
		])
	];

	if (!st.running || !st.listening) {
		nodes.push(E('p', { class: 'alert-message warning' }, [
			_('The portal is not serving requests. Change a setting and use "Save & Apply" to restart it; if the port stays unbound, another service may already be using it.')
		]));
	}

	return nodes;
}

function status_panel() {
	const body = E('div', { style: 'margin-bottom:.6em' }, E('em', {}, _('Querying…')));

	function refresh() {
		body.replaceChildren(E('em', {}, _('Querying…')));

		return callStatus().then(function(st) {
			body.replaceChildren(...status_view(st));
		}).catch(function(err) {
			body.replaceChildren(E('em', {},
				_('Status query failed: %s').format((err && err.message) || err)));
		});
	}

	const node = E('div', { class: 'cbi-section' }, [
		E('h3', {}, _('Service status')),
		body,
		E('div', { style: 'margin-top:.8em' }, [
			E('button', {
				class: 'btn cbi-button cbi-button-action',
				click: function(ev) {
					ev.preventDefault();
					return refresh();
				}
			}, _('Refresh')),
			' ',
			E('span', { class: 'cbi-value-description' },
				_('Re-reads the running instance, it does not change the configuration.'))
		])
	]);

	node.refresh = refresh;

	return node;
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

		const status = status_panel();

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

				return status.refresh();
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

		return m.render().then(function(mapNode) {
			/* The panel starts out empty, fill it once the map is built. */
			return status.refresh().then(function() {
				return E('div', {}, [ status, mapNode ]);
			});
		});
	}
});
