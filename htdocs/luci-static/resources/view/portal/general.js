'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require portal.common as common';

/*
 * Discover the locally reachable services and add the ones that are not
 * bookmarked yet as disabled entries. The changes are only staged here - the
 * user still has to tick the ones they want and apply, which is what the button
 * caption promises.
 *
 * The backend sorts the ports into three buckets rather than guessing:
 * services a browser cannot open (ssh, dns, a VPN) are dropped, known web
 * services are added, and everything else is reported as unrecognised. A port
 * number carries no protocol information - 7890 may be a proxy or an arbitrary
 * TCP service, 1053 is mDNS - so anything else would be a coin flip, and a
 * wrong bookmark is worse than an extra click.
 */
function scan_services() {
	return common.callScan().then(function(result) {
		const entries = (result && result.ports) || [];
		const host = (result && result.lan_ip) || window.location.hostname;
		let added = 0;
		let unknown = [];

		const add = function(entry) {
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
		};

		entries.forEach(function(entry) {
			if (entry.web === true)
				add(entry);
			else if (entry.web === 'unknown')
				unknown.push(entry);
		});

		if (!added)
			return { added: 0, unknown: unknown };

		return uci.save().then(function() {
			return { added: added, unknown: unknown };
		});
	});
}

/*
 * Ask what to do about the ports the scan could not classify.
 *
 * Dropping them silently would lose a service the user runs on an unusual
 * port; adding them automatically would put ssh and mDNS on the page. So they
 * are listed and the choice is explicit, and even when accepted they land
 * disabled like everything else the scan finds.
 */
function confirm_unknown(result) {
	const unknown = (result && result.unknown) || [];
	const host = (result && result.lan_ip) || window.location.hostname;
	const list = unknown
		.map(function(entry) { return String(entry.port); })
		.join(', ');

	ui.showModal(_('Unrecognised ports'), [
		E('p', {}, _('These listening ports could not be classified: %s').format(list)),
		E('p', { class: 'cbi-value-description' },
			_('A port number does not say which protocol is spoken on it, so they ' +
			  'were neither added nor dropped automatically.')),
		E('div', { class: 'right' }, [
			E('button', {
				class: 'btn',
				click: function() { ui.hideModal(); }
			}, _('Ignore')),
			' ',
			E('button', {
				class: 'btn cbi-button cbi-button-action',
				click: function() {
					ui.hideModal();

					return common.run_rpc(function() {
						let added = 0;

						unknown.forEach(function(entry) {
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

						return uci.save().then(function() { return { added: added }; });
					}, function(res) {
						return _('Added %d disabled bookmark(s) - tick the ones you want and apply.')
							.format((res && res.added) || 0);
					}).then(function(res) {
							if (res && res.added)
								window.setTimeout(function() { window.location.reload(); }, 1500);
						});
				}
			}, _('Add as disabled bookmarks'))
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('portal'),
			uci.load('uhttpd')
		]);
	},

	render: function() {
		return common.render_safe(function() {
			let m, s, o;

			const status = common.status_panel();

			m = new form.Map('portal', _('Portal'),
				_('A static HTML portal served by its own uhttpd instance on a dedicated ' +
				  'port. Settings are persisted in uci and baked into links.json on apply.'));

			/* --------------------------------------------------------- General -- */

			s = m.section(form.TypedSection, 'portal', _('General'));
			s.anonymous = true;
			s.addremove = false;

			/*
			 * The master switch. Absent or '1' means on; only an explicit '0'
			 * stops the daemon, which /etc/init.d/portal enforces when the
			 * configuration change triggers a reload.
			 */
			o = s.option(form.Flag, 'enabled', _('Enable portal'),
				_('Turn the portal service on or off. When off, the uhttpd instance is ' +
				  'stopped and the port is closed.'));
			o.default = '1';
			o.rmempty = false;

			o = s.option(form.Value, 'port', _('Listen port'));
			o.datatype = 'port';
			o.default = '8180';
			o.rmempty = false;
			o.validate = function(section_id, value) {
				const port = +value;

				if (port === 80 || port === 8080)
					return _('Ports 80 and 8080 are reserved by the main web server.');

				if (common.port_in_use(port))
					return _('This port is already used by the main uhttpd instance.');

				return true;
			};

			o = s.option(form.Value, 'title', _('Page title'));
			o.placeholder = 'My Portal';

			o = s.option(form.Value, 'background', _('Background colour'),
				_('A CSS colour value such as #0e1116.'));
			o.placeholder = '#0e1116';

			/*
			 * The image itself is managed on the Assets page and only reported
			 * here. DummyValue overrides write() to a no-op, so displaying the
			 * path cannot accidentally save it back.
			 */
			o = s.option(form.DummyValue, 'background_file', _('Current background image'),
				_('Chosen on the Assets page. It takes precedence over the colour.'));
			o.cfgvalue = function(section_id) {
				const value = uci.get('portal', section_id, 'background_file');

				return (value != null && value != '') ? value : _('none');
			};

			/*
			 * Appearance sliders. The values stay percentages in uci; the portal page
			 * turns them into the CSS custom properties the stylesheet consumes, so
			 * the two can never disagree about the scale.
			 *
			 * The defaults are what portal.css hard-coded before these options existed
			 * (a 78% scrim, no blur, cards at 45% transparency), so a configuration
			 * that predates them keeps rendering exactly as before.
			 */
			o = s.option(form.RangeSliderValue, 'bg_veil', _('Background veil'),
				_('How strongly a background image is dimmed, in percent. 0 leaves the ' +
				  'photo as it is, 100 hides it behind a solid scrim. Only applies when a ' +
				  'background image is set.'));
			o.min = 0;
			o.max = 100;
			o.step = 1;
			o.default = 78;
			o.calcunits = '%';
			o.rmempty = false;

			o = s.option(form.RangeSliderValue, 'bg_blur', _('Background blur'),
				_('Frosted-glass blur applied to a background image, in percent of the ' +
				  'maximum (20 px). 0 keeps the photo sharp.'));
			o.min = 0;
			o.max = 100;
			o.step = 1;
			o.default = 0;
			o.calcunits = '%';
			o.rmempty = false;

			o = s.option(form.RangeSliderValue, 'card_transparency',
				_('Bookmark transparency'),
				_('Transparency of the bookmark cards, in percent. 0 makes them solid, ' +
				  '100 lets the background shine through completely; the text stays ' +
				  'readable either way.'));
			o.min = 0;
			o.max = 100;
			o.step = 1;
			o.default = 45;
			o.calcunits = '%';
			o.rmempty = false;

			/* ----------------------------------------------------- Maintenance -- */

			s = m.section(form.TypedSection, 'portal', _('Maintenance'));
			s.anonymous = true;
			s.addremove = false;

			o = s.option(form.Button, '_generate', _('Static page'));
			o.inputtitle = _('Regenerate links.json now');
			o.inputstyle = 'apply';
			o.onclick = function() {
				return common.run_rpc(function() {
					return common.callGenerate();
				}, function(result) {
					return _('Regenerated: %d bookmark(s).')
						.format((result && result.links) || 0);
				}).then(function() {
					return status.refresh();
				});
			};

			o = s.option(form.Button, '_scan', _('Discovery'));
			o.inputtitle = _('Scan local services & add (disabled)');
			o.inputstyle = 'action';
			o.onclick = function() {
				return common.run_rpc(scan_services, function(result) {
					const added = (result && result.added) || 0;
					const unknown = (result && result.unknown) || [];

					if (added && !unknown.length)
						return _('Added %d disabled bookmark(s) - tick the ones you want and apply.')
							.format(added);

					if (added && unknown.length)
						return _('Added %d bookmark(s); %d port(s) were not recognised.')
							.format(added, unknown.length);

					if (!added && !unknown.length)
						return _('No new local services found.');

					return null;
				}).then(function(result) {
					const unknown = (result && result.unknown) || [];

					/*
					 * Unrecognised ports are not added and not forgotten: offer
					 * them explicitly, so the decision stays with the user
					 * instead of being made by a guess in either direction.
					 */
					if (unknown.length)
						return confirm_unknown(result);

					/*
					 * The staged bookmarks only become visible on the Bookmarks
					 * page, so redraw it - but give the notification a moment
					 * first, a reload would wipe it instantly.
					 */
					if (result && result.added)
						window.setTimeout(function() { window.location.reload(); }, 1500);

					return result;
				});
			};

			return m.render().then(function(mapNode) {
				/* The panel starts out empty, fill it once the map is built. */
				return status.refresh().then(function() {
					return E('div', {}, [ status, mapNode ]);
				});
			});
		}.bind(this));
	}
});
