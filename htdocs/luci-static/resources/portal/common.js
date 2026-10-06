'use strict';
'require rpc';
'require uci';
'require ui';
'require baseclass';

/*
 * Shared helpers for the portal views. Loaded as
 *
 *     'require portal.common as common';
 *
 * The `as common` part only picks the variable name - the module system derives
 * it from the last path segment otherwise.
 *
 * This module MUST return a class, not a plain object. LuCI's require() wraps
 * the factory output in a class check (`Class.isSubclass()`) and then does
 * `new` on it, so returning an object literal fails with
 *
 *     TypeError: "portal.common" factory yields invalid constructor
 *
 * The rpc handles stay at the top level on purpose: they are created once when
 * the file is evaluated, and the methods below close over them. Putting them
 * into the extend object would rebuild them on every instantiation.
 */

/*
 * `reject: true` is not optional here: it is what turns a rejected ubus call
 * into a rejected promise instead of a result of 2. See run_rpc() below.
 */
const callStatus = rpc.declare({
	object: 'luci.portal',
	method: 'status',
	reject: true
});

const callGenerate = rpc.declare({
	object: 'luci.portal',
	method: 'generate',
	reject: true
});

const callScan = rpc.declare({
	object: 'luci.portal',
	method: 'scan',
	params: [ 'ports' ],
	reject: true
});

/*
 * What a failed render() leaves on the page instead of throwing.
 *
 * The stack goes in a <pre> rather than into a notification: LuCI's own error
 * path shows a modal that the SPA router then tears down with the aborted
 * stage, so a message delivered that way is gone before it can be read.
 */
function render_error_block(err) {
	return E('div', { class: 'alert-message error' }, [
		E('p', {}, _('Error')),
		E('pre', { style: 'white-space:pre-wrap' }, String((err && err.message) || err))
	]);
}

return baseclass.extend(/** @lends LuCI.portal.common.prototype */ {

	/*
	 * Refuse ports that the main uhttpd instance already listens on. The uhttpd
	 * configuration is read client side, so it is also listed in the read ACL.
	 */
	port_in_use(port) {
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
	},

	/*
	 * Show a notification, replacing the previous one this app put up.
	 *
	 * ui.addNotification() inserts a fresh banner at the top of #maincontent and
	 * never takes an old one down, so repeated clicks on Save or "Select all"
	 * stack the banners up and the page grows taller with every click. Holding
	 * on to the node the previous call returned and removing it first leaves at
	 * most one banner on screen, which is what makes the message readable
	 * instead of a wall of identical lines.
	 */
	notify(title, children, type) {
		if (this._notification != null && this._notification.parentNode != null)
			this._notification.parentNode.removeChild(this._notification);

		this._notification = ui.addNotification(title, children, type);

		return this._notification;
	},

	/*
	 * Run an action that talks to the backend, with visible feedback either way.
	 *
	 * LuCI does not do this for us: ui.createHandlerFn() wraps a button handler in
	 * Promise.resolve(...).finally(...) and never attaches a .catch(), so a rejected
	 * promise ends up in the console while the user sees nothing at all. Every
	 * button that calls the backend goes through here, so a failure always surfaces
	 * as a notification instead of a click that appears to do nothing.
	 *
	 * okMsg is a string, or a function(result) returning one; it is skipped when the
	 * action resolves to null.
	 *
	 * Failures arrive in two shapes and both have to be caught here:
	 *
	 *  - an ubus level error (unknown method, missing ACL entry, an argument the
	 *    method policy does not allow) never reaches the action at all. LuCI
	 *    resolves the numeric status as the call result unless the rpc.declare()
	 *    for that method sets `reject: true`, so every declaration in this app
	 *    carries it - without it a failed call is indistinguishable from success;
	 *  - an application level failure (a name that is already taken, a directory
	 *    that cannot be written) resolves normally with { ok: false, error: ... },
	 *    which is rethrown just below.
	 */
	run_rpc(action, okMsg) {
		return Promise.resolve()
			.then(action)
			.then((res) => {
				/*
				 * The backend reports failure by resolving with { ok: false, error:
				 * ... } instead of rejecting, so a bare null check would read it as
				 * success. Rethrow it so the catch below reports the error instead
				 * of a bogus success notification.
				 */
				if (res != null && res.ok === false)
					throw new Error(res.error);

				if (okMsg != null && res != null)
					this.notify(null, E('p', {},
						(typeof(okMsg) === 'function') ? okMsg(res) : okMsg), 'info');

				return res;
			})
			.catch((err) => {
				/* 'error' is defined by both the bootstrap and the argon themes. */
				this.notify(_('Error'),
					E('p', {}, _('Operation failed: %s').format((err && err.message) || err)),
					'error');

				return null;
			});
	},

	/*
	 * Run a view's render() body so that a failure ends the page instead of the
	 * session.
	 *
	 * Why this is needed: LuCI's View.__init__ is
	 *   .then(load).then(render).then(paint).catch(LuCI.prototype.error)
	 * and error() re-throws after showing its notification. Under
	 * luci-theme-footstrap's SPA router that is expensive, because it
	 * serializes navigations (`const previous = _inflight`): a view that never
	 * paints keeps every later click queued until the 15000 ms
	 * RENDER_TIMEOUT expires, and history.pushState has already moved the
	 * address bar by then - so the URL and the page disagree. Catching here
	 * returns a real DOM node, the view paints, the queue drains immediately
	 * and the next click navigates at once.
	 *
	 * The asynchronous half is not optional: general.js returns a promise
	 * (form.Map#render), so a plain try/catch would let a rejection escape
	 * through exactly the path this is meant to close.
	 *
	 * `context` is the view instance - render() runs with `this` bound to it,
	 * and the body still needs that.
	 */
	render_safe(fn, context) {
		let res;

		try {
			res = fn.call(context);
		}
		catch (err) {
			return render_error_block(err);
		}

		return Promise.resolve(res).catch(render_error_block);
	},

	badge(text, ok) {
		return E('span', {
			style: 'display:inline-block;padding:1px 8px;border-radius:9px;color:#fff;' +
				'font-size:90%;white-space:nowrap;background:' + (ok ? '#2e7d32' : '#c62828')
		}, text);
	},

	/*
	 * A neutral badge for states that are neither good nor bad. A portal the user
	 * deliberately switched off is not a failure, so it must not be painted red.
	 */
	muted_badge(text) {
		return E('span', {
			style: 'display:inline-block;padding:1px 8px;border-radius:9px;color:#fff;' +
				'font-size:90%;white-space:nowrap;background:#607d8b'
		}, text);
	},

	status_row(label, value) {
		return E('tr', { class: 'tr' }, [
			E('td', { class: 'td left', style: 'width:32%' }, label),
			E('td', { class: 'td left' }, value)
		]);
	},

	/*
	 * A missing listener is the interesting case: procd keeps restarting a daemon
	 * that dies immediately, so "running" alone would be misleading.
	 *
	 * `enabled` is a separate axis again: when it is false the daemon is supposed to
	 * be absent, which is why the failure hint below is replaced by a hint pointing
	 * at the switch.
	 */
	status_view(st) {
		if (!st)
			return [ E('em', {}, _('Service state unknown.')) ];

		const on = (st.enabled !== false);

		const nodes = [
			E('table', { class: 'table' }, [
				this.status_row(_('Service'), on
					? [
						this.badge(st.running ? _('Running') : _('Stopped'), st.running),
						st.running && st.pid ? ' ' + _('PID %d').format(st.pid) : ''
					]
					: [ this.muted_badge(_('Disabled')) ]),
				this.status_row(_('Listening'), [
					this.badge(st.listening ? _('Yes') : _('No'), st.listening),
					st.listening ? '' : ' ' + _('nothing is bound to port %d').format(st.port)
				]),
				this.status_row(_('Port'), String(st.port)),
				this.status_row(_('Address'), st.url
					? E('a', { href: st.url, target: '_blank', rel: 'noopener' }, st.url)
					: E('em', {}, _('unknown'))),
				this.status_row(_('Bookmarks'), st.generated
					? _('%d baked into links.json').format(st.links)
					: E('em', {}, _('links.json has not been generated yet')))
			])
		];

		if (!on) {
			nodes.push(E('p', { class: 'alert-message' }, [
				_('The portal is switched off. Turn on "Enable portal" above, then press "Save & Apply" to start it.')
			]));
		}
		else if (!st.running || !st.listening) {
			nodes.push(E('p', { class: 'alert-message warning' }, [
				_('The portal is not serving requests. Change a setting and use "Save & Apply" to restart it; if the port stays unbound, another service may already be using it.')
			]));
		}

		return nodes;
	},

	status_panel() {
		const body = E('div', { style: 'margin-bottom:.6em' }, E('em', {}, _('Querying…')));

		// Bound to the instance so that the helpers below resolve through the
		// prototype, exactly like a method call would.
		const self = this;

		function refresh() {
			body.replaceChildren(E('em', {}, _('Querying…')));

			return callStatus().then(function(st) {
				body.replaceChildren(...self.status_view(st));
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
	},

	callStatus: callStatus,
	callGenerate: callGenerate,
	callScan: callScan
});
