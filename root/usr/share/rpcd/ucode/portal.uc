#!/usr/bin/env ucode

// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 cocolight
//
// luci-app-portal backend.
//
// Loaded by rpcd-mod-ucode, this file provides the `luci.portal` ubus object:
//
//     luci.portal scan      -> { "lan_ip": "192.168.1.1", "ports": [ { "port": 80, "svc": "http" } ] }
//     luci.portal generate  -> { "ok": true, "title": "My Portal", "links": 2 }
//
// The very same file doubles as a command line tool, which is what
// /etc/init.d/portal and the package post-install script invoke:
//
//     ucode /usr/share/rpcd/ucode/portal.uc --cli generate

'use strict';

import { cursor } from 'uci';
import { mkdir, open, readfile } from 'fs';

const CONFIG = 'portal';
const WWW = '/etc/portal/www';

/* Well known router services, kept in sync with the previous release. */
const SVC = {
	22: 'ssh', 53: 'dns', 80: 'http', 443: 'https',
	3000: 'http-alt', 5000: 'http-alt', 5053: 'dns', 8000: 'http',
	8080: 'http-alt', 8081: 'http-alt', 8123: 'http', 8181: 'http',
	8384: 'syncthing', 8443: 'https-alt', 8888: 'http', 9000: 'http',
	9090: 'cockpit', 6888: 'http', 1194: 'openvpn', 51820: 'wireguard'
};

/* Addresses whose listeners are reachable from the LAN. */
const ADDR_ANY4 = '00000000';
const ADDR_ANY6 = '00000000000000000000000000000000';

/* --------------------------------------------------------------- helpers -- */

/*
 * Return the options of the first section of the given type, with the
 * bookkeeping keys (`.name`, `.type`, `.anonymous`) filtered out.
 */
function first_section(uci, type) {
	let options = {};

	uci.foreach(CONFIG, type, (section) => {
		const collected = {};

		for (let key, value in section)
			if (index(key, '.') != 0)
				collected[key] = value;

		options = collected;

		return false; /* stop after the first section */
	});

	return options;
}

function ensure_dir(path) {
	try {
		mkdir(path, 0o755);
	}
	catch (e) {
		/* Already present, or a path we cannot create - writing the file
		 * below will surface the real error. */
	}
}

/*
 * form.FileUpload stores absolute paths below the document root, so strip the
 * prefix to obtain something the browser can request. A bare file name, as
 * written by the previous Lua release, is relative to `subdir`.
 */
function asset_path(value, subdir) {
	if (value == null || value == '')
		return '';

	if (index(value, WWW + '/') == 0)
		return substr(value, length(WWW) + 1);

	if (index(value, '/') != 0)
		return subdir + '/' + value;

	return value;
}

function ip4_to_hex(ip) {
	const parts = split(ip ?? '', /\./);

	if (length(parts) != 4)
		return null;

	let hexip = '';

	for (let i = 0; i < 4; i++) {
		const octet = int(parts[i]);

		if (octet == null || octet < 0 || octet > 255)
			return null;

		hexip += sprintf('%02X', octet);
	}

	return hexip;
}

function lan_ip() {
	const uci = cursor();

	uci.load('network');

	const ip = uci.get('network', 'lan', 'ipaddr');

	return type(ip) == 'string' ? ip : '';
}

/* ----------------------------------------------------------- port scanning -- */

/*
 * Collect the TCP ports listening on a locally reachable address.
 *
 * /proc is parsed instead of probing with `nc`, so there is neither an extra
 * dependency nor a per-port timeout. A port is reported when it is in LISTEN
 * state and bound to the IPv4 wildcard, the IPv6 dual stack wildcard or the
 * LAN address - loopback only services are skipped on purpose, as they cannot
 * be reached through a bookmark pointing at the router address.
 */
function listening_ports(only) {
	const wanted = {};
	const hexlan = ip4_to_hex(lan_ip());

	if (type(only) == 'array')
		for (let port in only)
			wanted[int(port)] = true;

	const found = {};

	for (let file in [ '/proc/net/tcp', '/proc/net/tcp6' ]) {
		let text;

		try {
			text = readfile(file);
		}
		catch (e) {
			continue; /* IPv6 disabled or /proc unavailable */
		}

		if (text == null)
			continue;

		for (let line in split(text, '\n')) {
			const fields = match(line,
				/^\s*\d+:\s+([0-9A-Fa-f]{8,32}):([0-9A-Fa-f]{4})\s+[0-9A-Fa-f]{8,32}:[0-9A-Fa-f]{4}\s+([0-9A-Fa-f]{2})\s/);

			if (fields == null || fields[3] != '0A')
				continue;

			const address = fields[1];
			const port = hex(fields[2]);

			if (address != ADDR_ANY4 && address != ADDR_ANY6 && address != hexlan)
				continue;

			if (length(wanted) > 0 && wanted[port] != true)
				continue;

			found[port] = true;
		}
	}

	const ports = keys(found);

	sort(ports, (a, b) => a - b);

	return ports;
}

/* --------------------------------------------------------------- methods -- */

/*
 * Bake /etc/portal/www/links.json from the uci configuration. The served page
 * is static, so the bookmarks are turned into a plain JSON document that the
 * frontend fetches.
 */
function generate() {
	const uci = cursor();

	uci.load(CONFIG);

	const general = first_section(uci, 'portal');

	const data = {
		title: general.title ?? 'Portal',
		background: '',
		links: []
	};

	if (general.background_file != null && general.background_file != '')
		data.background = asset_path(general.background_file, 'bg');
	else if (general.background != null && general.background != '')
		data.background = general.background;

	uci.foreach(CONFIG, 'link', (section) => {
		if (section.enabled == '0')
			return;

		push(data.links, {
			name: section.name ?? '',
			url: section.url ?? '',
			icon: asset_path(section.icon, 'icons') || (section.icon_url ?? '')
		});
	});

	ensure_dir(WWW);

	const fd = open(WWW + '/links.json', 'w', 0o644);

	if (fd == null)
		return { ok: false, error: 'unable to write ' + WWW + '/links.json' };

	fd.write(sprintf('%J', data));
	fd.close();

	return { ok: true, title: data.title, links: length(data.links) };
}

/*
 * Report the locally reachable listening TCP services. The optional `ports`
 * array restricts the result to those ports.
 */
function scan(request) {
	const requested = (type(request) == 'object' && request != null) ? request.ports : null;
	const result = [];

	for (let port in listening_ports(requested))
		push(result, { port: port, svc: SVC[port] ?? '' });

	return { lan_ip: lan_ip(), ports: result };
}

const methods = {
	generate: { call: () => generate() },
	scan: { call: (request) => scan(request) }
};

/*
 * Command line mode. rpcd never passes `--cli`, so the two modes cannot be
 * mixed up.
 */
if (ARGV[0] == '--cli') {
	const method = methods[ARGV[1]];

	if (method == null)
		exit(1);

	const result = method.call(null);

	exit(type(result) == 'object' && result.ok == false ? 1 : 0);
}

return { 'luci.portal': methods };
