'use strict';
'require view';
'require fs';
'require rpc';
'require request';
'require uci';
'require ui';
'require portal.common as common';

const ICON_DIR = '/etc/portal/www/icons';
const BG_DIR = '/etc/portal/www/bg';

/*
 * Uploads are rejected above this size. It is enforced here so the user gets an
 * immediate answer instead of a slow upload that fails at the far end, and
 * again in the backend so a hand crafted request cannot bypass it.
 */
const MAX_UPLOAD = 2 * 1024 * 1024;

/*
 * Where the browser drops the uploaded bytes. cgi-upload can only write where
 * the ACL says, and the backend moves the file to its final name from there -
 * which is what keeps the destination out of the browser's reach.
 */
const TMP_UPLOAD = '/tmp/portal_upload.tmp';

const MIME = {
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
	svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp'
};

const NAME_RE = /^[A-Za-z0-9_.\-]+$/;

const callUpload = rpc.declare({
	object: 'luci.portal',
	method: 'upload',
	params: [ 'dir', 'name' ]
});

const callRemove = rpc.declare({
	object: 'luci.portal',
	method: 'remove',
	params: [ 'dir', 'name' ]
});

const callRename = rpc.declare({
	object: 'luci.portal',
	method: 'rename',
	params: [ 'dir', 'name', 'new_name' ]
});

function extension(name) {
	return (name.split('.').pop() || '').toLowerCase();
}

function mime_of(name) {
	return MIME[extension(name)];
}

function human_size(bytes) {
	if (bytes == null)
		return '';

	const units = [ 'B', 'KiB', 'MiB' ];
	let value = bytes, unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	return (unit === 0 ? String(value) : value.toFixed(1)) + ' ' + units[unit];
}

function human_time(seconds) {
	return (seconds != null) ? new Date(seconds * 1000).toLocaleString() : '';
}

/* 'bg' or 'icons' - the short name the backend uses to address a directory. */
function dir_key(dir) {
	return (dir === BG_DIR) ? 'bg' : 'icons';
}

/*
 * A URL the browser can fetch the file from directly, served by the portal's
 * own uhttpd instance.
 *
 * Thumbnails used to be inlined as base64 over ubus, which capped them at
 * RPC_FILE_MAX_SIZE (256 KiB) - smaller than a typical background image.
 * Fetching over HTTP has no such ceiling, because the payload never becomes a
 * ubus message.
 *
 * The version appended to the URL is what makes replacing a file actually
 * change it: without it the browser keeps showing the cached copy. Modtime plus
 * size is used for the same reason as on the portal page - the timestamp has
 * one second resolution, so two quick changes could otherwise share a URL.
 *
 * Returns null when the portal speaks plain HTTP while LuCI is on HTTPS - the
 * browser would block the image as mixed content, and a broken thumbnail is
 * worse than an honest text link.
 *
 * The version suffix is folded into the returned expression rather than
 * appended afterwards: building the string in two steps and reassigning it is
 * exactly what a `const` binding cannot do, and a throw here takes down the
 * whole page (see common.render_safe for why that is expensive).
 */
function portal_url(dir, name, entry) {
	if (window.location.protocol === 'https:')
		return null;

	const sections = uci.sections('portal', 'portal');
	const port = (sections.length && uci.get('portal', sections[0]['.name'], 'port')) || '8180';
	const base = 'http://' + window.location.hostname + ':' + port + '/' +
		dir_key(dir) + '/' + encodeURIComponent(name);

	return (entry != null) ? base + '?v=' + entry.mtime + '-' + entry.size : base;
}

function fallback_link(dir, entry) {
	const url = portal_url(dir, entry.name, entry);

	if (url == null)
		return E('em', {}, _('preview unavailable'));

	return E('a', {
		href: url,
		target: '_blank',
		rel: 'noopener'
	}, _('open'));
}

function thumbnail(dir, entry) {
	if (mime_of(entry.name) == null)
		return E('em', {}, _('not an image'));

	const url = portal_url(dir, entry.name, entry);

	if (url == null)
		return fallback_link(dir, entry);

	const img = E('img', {
		width: 48,
		height: 48,
		style: 'object-fit:contain;border-radius:6px;border:1px solid #8883',
		src: url,
		alt: entry.name
	});

	/* A file that is not an image after all, or was removed meanwhile. */
	img.addEventListener('error', function() {
		img.replaceWith(fallback_link(dir, entry));
	});

	return img;
}

/*
 * One unreadable entry must not cost the whole page.
 *
 * The rows are built inside a single .map(), so anything thrown while
 * assembling one cell aborts the rest of the list and the view never paints.
 * Degrading to the same text an unsupported file gets keeps the page usable
 * and leaves the other rows intact.
 */
function safe_thumbnail(dir, entry) {
	try {
		return thumbnail(dir, entry);
	}
	catch (e) {
		return E('em', {}, _('not an image'));
	}
}

function reload_soon() {
	/* Let the notification be readable before the page is replaced. */
	window.setTimeout(function() { window.location.reload(); }, 1200);
}

/*
 * Upload through LuCI's own cgi-upload endpoint, the very path its file upload
 * widget uses. Unlike ubus it is not constrained by the message size limit.
 *
 * The file goes to a fixed temporary path rather than to its final name: the
 * backend resolves the destination itself and moves the file there, so the
 * request cannot place a file outside the two asset directories.
 */
function upload(dir, file) {
	if (file.size > MAX_UPLOAD)
		return common.run_rpc(function() {
			throw new Error(_('Image is larger than 2 MiB (%s).').format(human_size(file.size)));
		}, null);

	const name = file.name.replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9_.\-]/g, '_');
	const data = new FormData();

	data.append('sessionid', rpc.getSessionID());
	data.append('filename', TMP_UPLOAD);
	data.append('filedata', file);

	return common.run_rpc(function() {
		return request.post(L.env.cgi_base + '/cgi-upload', data, { timeout: 0 })
			.then(function(res) {
				const reply = res.json();

				if (L.isObject(reply) && reply.failure)
					throw new Error(reply.message || reply.failure);

				return callUpload({ dir: dir_key(dir), name: name });
			});
	}, _('Uploaded %s.').format(name)).then(function(res) {
		if (res != null)
			reload_soon();
	});
}

function upload_button(dir) {
	const input = E('input', {
		type: 'file',
		accept: 'image/*',
		style: 'display:none',
		change: function(ev) {
			const file = ev.currentTarget.files[0];

			ev.currentTarget.value = '';

			if (file != null)
				upload(dir, file);
		}
	});

	return E('div', {}, [
		input,
		E('button', {
			class: 'btn cbi-button cbi-button-action',
			click: function(ev) {
				ev.preventDefault();
				input.click();
			}
		}, _('Upload')),
		' ',
		E('span', { class: 'cbi-value-description' }, _('Up to 2 MiB per file.'))
	]);
}

/*
 * Renaming goes through the backend rather than a read plus a write, so it
 * works for a file of any size and cannot leave a half written image behind.
 */
function rename_file(dir, entry) {
	const input = E('input', {
		type: 'text',
		value: entry.name,
		style: 'width:100%'
	});

	return ui.showModal(_('Rename'), [
		E('p', {}, _('Choose a new name. Letters, digits, dot, dash and underscore only.')),
		E('div', { class: 'cbi-value' }, input),
		E('div', { class: 'right' }, [
			E('button', {
				class: 'btn',
				click: function() { ui.hideModal(); }
			}, _('Cancel')),
			' ',
			E('button', {
				class: 'btn cbi-button cbi-button-action',
				click: function() {
					const name = input.value.trim();

					if (!NAME_RE.test(name))
						return common.run_rpc(function() {
							throw new Error(_('Invalid file name.'));
						}, null);

					ui.hideModal();

					return common.run_rpc(function() {
						return callRename({ dir: dir_key(dir), name: entry.name, new_name: name });
					}, _('Renamed to %s.').format(name)).then(function(res) {
						if (res != null)
							reload_soon();
					});
				}
			}, _('Rename'))
		])
	]);

	return null;
}

function remove_file(dir, entry) {
	return ui.showModal(_('Delete'), [
		E('p', {}, _('Delete %s?').format(entry.name)),
		E('p', { class: 'cbi-value-description' },
			_('Bookmarks using this file and the current background will be cleared.')),
		E('div', { class: 'right' }, [
			E('button', {
				class: 'btn',
				click: function() { ui.hideModal(); }
			}, _('Cancel')),
			' ',
			E('button', {
				class: 'btn cbi-button cbi-button-negative',
				click: function() {
					ui.hideModal();

					return common.run_rpc(function() {
						return callRemove({ dir: dir_key(dir), name: entry.name });
					}, _('Deleted %s.').format(entry.name)).then(function(res) {
						if (res != null)
							reload_soon();
					});
				}
			}, _('Delete'))
		])
	]);
}

/*
 * Point the portal at this file.
 *
 * The value is only staged, like every other setting on this page: the footer
 * "Save & Apply" button is what commits it. Applying is also what re-bakes
 * links.json - generate() runs in the rpcd plugin process with its own uci
 * cursor, so it never sees this session's staged changes and would otherwise
 * bake the old value.
 */
function set_background(entry) {
	const sections = uci.sections('portal', 'portal');

	if (!sections.length)
		return Promise.resolve();

	uci.set('portal', sections[0]['.name'], 'background_file', BG_DIR + '/' + entry.name);

	return common.run_rpc(function() {
		return uci.save();
	}, _('Background set to %s. Press "Save & Apply" below to make it take effect.')
		.format(entry.name));
}

function asset_section(title, dir, entries, current_bg) {
	const rows = entries
		.filter(function(entry) { return entry.type === 'file'; })
		.sort(function(a, b) { return a.name.localeCompare(b.name); })
		.map(function(entry) {
			const is_current = (dir === BG_DIR) && (current_bg === dir + '/' + entry.name);

			return E('tr', { class: 'tr' }, [
				E('td', { class: 'td', style: 'width:64px' }, safe_thumbnail(dir, entry)),
				E('td', { class: 'td left' }, [
					entry.name,
					is_current ? ' ' : '',
					is_current ? E('span', { class: 'cbi-value-description' }, _('(current)')) : ''
				]),
				E('td', { class: 'td right' }, human_size(entry.size)),
				E('td', { class: 'td right' }, human_time(entry.mtime)),
				E('td', { class: 'td right' }, [
					(dir === BG_DIR) ? E('button', {
						class: 'btn cbi-button',
						click: function() { return set_background(entry); }
					}, _('Set as background')) : '',
					' ',
					E('button', {
						class: 'btn cbi-button',
						click: function() { rename_file(dir, entry); }
					}, _('Rename')),
					' ',
					E('button', {
						class: 'btn cbi-button cbi-button-negative',
						click: function() { remove_file(dir, entry); }
					}, _('Delete'))
				])
			]);
		});

	return E('div', { class: 'cbi-section' }, [
		E('h3', {}, title),
		E('div', { style: 'margin-bottom:.6em' }, upload_button(dir)),
		rows.length
			? E('table', { class: 'table' }, [
				E('tr', { class: 'tr table-titles' }, [
					E('th', { class: 'th' }, ''),
					E('th', { class: 'th left' }, _('Name')),
					E('th', { class: 'th right' }, _('Size')),
					E('th', { class: 'th right' }, _('Modified')),
					E('th', { class: 'th right' }, _('Actions'))
				])
			].concat(rows))
			: E('p', {}, E('em', {}, _('No files yet.')))
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('portal'),
			fs.list(ICON_DIR).catch(function() { return []; }),
			fs.list(BG_DIR).catch(function() { return []; })
		]).then(function(data) {
			this.icons = data[1] || [];
			this.bgs = data[2] || [];

			const sections = uci.sections('portal', 'portal');

			this.current_bg = sections.length
				? (uci.get('portal', sections[0]['.name'], 'background_file') || '')
				: '';
		}.bind(this));
	},

	render: function() {
		return common.render_safe(function() {
			/*
			 * The cbi-map wrapper is what makes LuCI render the page footer with its
			 * "Save & Apply" button (view.addFooter() looks for one). The staged
			 * background is picked up by uci.save() rather than by a form widget,
			 * so no form.Map is needed - the button commits whatever uci has staged.
			 */
			return E('div', { class: 'cbi-map' }, [
				E('h2', {}, _('Assets')),
				E('div', { class: 'cbi-map-descr' },
					_('Icons and background images offered to the portal. Files are served ' +
					  'from the portal document root, picked for a bookmark on the ' +
					  'Bookmarks page, or set as the page background here.')),
				asset_section(_('Icons'), ICON_DIR, this.icons, null),
				asset_section(_('Backgrounds'), BG_DIR, this.bgs, this.current_bg)
			]);
		}.bind(this));
	}
});
