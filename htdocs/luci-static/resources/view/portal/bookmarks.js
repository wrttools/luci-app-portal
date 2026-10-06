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

/*
 * Drop the given sections and commit. Both bulk deletions use this, after asking
 * for confirmation.
 */
function drop_sections(sids) {
	sids.forEach(function(sid) {
		uci.remove('portal', sid);
	});

	return commit();
}

function reload_soon() {
	/* The notifications are added to the page itself, so let them be read. */
	window.setTimeout(function() { window.location.reload(); }, 1500);
}

/*
 * Second confirmation for a destructive action.
 *
 * Both bulk deletions rewrite the whole table, so a misclick is expensive. The
 * message spells out how many rows are about to be lost, and the count comes from
 * the widgets rather than from uci: a row that is unticked but not saved yet is
 * still one the user sees as disabled, and the dialog must not promise less than
 * the action does.
 */
function confirm_removal(title, message, on_confirm) {
	ui.showModal(title, [
		E('p', {}, message),
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
					return on_confirm();
				}
			}, _('Delete'))
		])
	]);
}

/* ---------------------------------------------------------------- the table -- */

const BookmarkTable = form.TableSection.extend({
	/*
	 * The "Enabled" column header is where the select-all box belongs: it sits
	 * directly above the flags it drives, instead of floating above the table
	 * (form.Button inside a TableSection would occupy a column of every row).
	 *
	 * The flags are driven through their own widget instances rather than by
	 * poking at the DOM. Map.parse() reads the value back with
	 * CBIFlagValue.formvalue(), which asks the ui.Checkbox whether it is checked,
	 * so setting it here is exactly what a user click does - and no synthetic
	 * change event is needed for the value to be picked up.
	 *
	 * Ticking the box only stages the change, like every other input on the page:
	 * it is the footer "Save & Apply" (or the per-row Save) that commits it.
	 */
	renderHeaderRows(has_action) {
		const node = this.super('renderHeaderRows', [ has_action ]);
		const flag = this.flag;

		if (flag == null)
			return node;

		const row = node.querySelector('tr.cbi-section-table-titles:not(.cbi-section-table-filter)');
		const th = (row != null) ? row.children[this.children.indexOf(flag)] : null;

		if (th == null)
			return node;

		/*
		 * The column name moves down to the description row, where the other
		 * column hints live - the tick box in the titles row speaks for itself.
		 * That row exists because the Icon column carries a hint, and it holds
		 * one cell per column, so the flag's cell sits at the same index the
		 * titles row uses. Clearing the title text first also leaves the box as
		 * the only child of its cell.
		 */
		th.textContent = '';

		const descr = node.querySelector('tr.cbi-section-table-descr');
		const hint = (descr != null) ? descr.children[this.children.indexOf(flag)] : null;

		if (hint != null)
			hint.textContent = _('Enabled');

		this.select_all = E('input', {
			type: 'checkbox',
			title: _('Select all'),
			style: 'margin:0 0 0 .4em;vertical-align:middle',
			change: function(ev) { this.toggle_all(ev.target.checked); }.bind(this)
		});

		th.appendChild(this.select_all);

		return node;
	},

	toggle_all(on) {
		const flag = this.flag;
		let count = 0;

		this.cfgsections().forEach(function(sid) {
			const elem = flag.getUIElement(sid);

			if (elem == null)
				return;

			elem.setValue(on ? flag.enabled : flag.disabled);
			count++;
		});

		this.sync_select_all();

		if (count > 0)
			ui.addNotification(null, E('p', {}, on
				? _('Enabled %d bookmark(s). Press "Save & Apply" to keep the change.').format(count)
				: _('Disabled %d bookmark(s). Press "Save & Apply" to keep the change.').format(count)), 'info');
	},

	/*
	 * Keep the header box honest: a "select all" that stays ticked while a single
	 * row is unticked is a lie. The state is recomputed from the rendered
	 * checkboxes, and shown as an indeterminate box while only some rows are on.
	 */
	sync_select_all() {
		const box = this.select_all;

		if (box == null || this.section_node == null)
			return;

		const boxes = this.section_node.querySelectorAll('tbody input[type="checkbox"]');
		let on = 0;

		boxes.forEach(function(elem) { if (elem.checked) on++; });

		box.checked = (boxes.length > 0 && on === boxes.length);
		box.indeterminate = (on > 0 && on < boxes.length);
	},

	render() {
		const self = this;

		/*
		 * The empty array is not decoration: LuCI's super(key) with a single
		 * argument returns the parent method itself, it only calls it when
		 * arguments are supplied (super('key', args)). Omitting it hands the
		 * function to the promise chain instead of the rendered node.
		 */
		return Promise.resolve(this.super('render', [])).then(function(node) {
			self.section_node = node;

			/*
			 * One delegated listener instead of one per row: rows are added and
			 * removed at runtime (Add, per-row Delete), so per-row listeners would
			 * have to be re-attached over and over. Change events bubble, and the
			 * header box fires its own change event, which is filtered out here.
			 */
			node.addEventListener('change', function(ev) {
				if (ev.target !== self.select_all)
					self.sync_select_all();
			});

			self.sync_select_all();

			return node;
		});
	},

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
	},

	/*
	 * The two bulk deletions, to the right of "Add". Both are irreversible, so
	 * both are painted as negative buttons and both ask for confirmation first.
	 * `only_disabled` selects the target set: the rows whose "Enabled" box is
	 * currently unticked, or every row.
	 */
	bulk_delete(label, only_disabled) {
		const self = this;

		return E('button', {
			class: 'btn cbi-button cbi-button-negative',
			disabled: this.map.readonly || null,
			click: function(ev) {
				ev.preventDefault();

				const flag = self.flag;

				const sids = self.cfgsections().filter(function(sid) {
					return !only_disabled || (flag.formvalue(sid) !== flag.enabled);
				});

				if (!sids.length) {
					ui.addNotification(null, E('p', {}, only_disabled
						? _('There is no disabled bookmark to delete.')
						: _('There is no bookmark to delete.')), 'info');

					return;
				}

				confirm_removal(label, only_disabled
					? _('This removes %d disabled bookmark(s) from the configuration. It cannot be undone.').format(sids.length)
					: _('This removes all %d bookmark(s) from the configuration. It cannot be undone.').format(sids.length),
					function() {
						return common.run_rpc(function() {
							return drop_sections(sids).then(function() { return { removed: sids.length }; });
						}, function(res) {
							return _('Deleted %d bookmark(s).').format(res.removed);
						}).then(function(res) {
							if (res != null)
								reload_soon();
						});
					});
			}
		}, [ label ]);
	},

	renderSectionAdd(extra_class) {
		const node = this.super('renderSectionAdd', [ extra_class ]);

		if (!this.addremove || this.flag == null)
			return node;

		node.appendChild(this.bulk_delete(_('Delete disabled bookmarks'), true));
		node.appendChild(this.bulk_delete(_('Clear all bookmarks'), false));

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

			/*
			 * The select-all box in the header and the bulk deletions need the
			 * flag option to read and drive the per-row checkboxes; the section is
			 * not rendered yet, so handing it over here is enough.
			 */
			s.flag = o;

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

			return m.render();
		}.bind(this));
	}
});
