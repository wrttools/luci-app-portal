#!/bin/sh
# Local and CI gate for luci-app-portal.
#
# This project is a pure script package with no compiled unit tests, so the gate
# is syntax-level plus cross-reference consistency. It runs the very same script
# locally and in CI (.github/workflows/build.yml) so the two cannot drift.
#
# Add a check here and in nothing else - CI invokes this file directly.
#
# Usage: sh scripts/check.sh      (no arguments, no configuration)

set -eu

cd "$(dirname "$0")/.."
ROOT=$(pwd)

failed=0
note() { printf '\n--- %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; failed=1; }
ok() { printf '  ok  %s\n' "$1"; }

# ---------------------------------------------------------------- JS syntax
# The four LuCI views/resources and the standalone portal frontend. `node
# --check` parses without executing, so no LuCI runtime is needed.
note "JavaScript syntax"
if ! command -v node >/dev/null 2>&1; then
	# Skipping loudly beats five bogus FAILs: `node: command not found` would
	# otherwise be reported as a syntax error in every file.
	printf '  skip  node not installed (CI has it; see build.yml)\n'
else
	for f in \
		htdocs/luci-static/resources/portal/common.js \
		htdocs/luci-static/resources/view/portal/general.js \
		htdocs/luci-static/resources/view/portal/bookmarks.js \
		htdocs/luci-static/resources/view/portal/assets.js \
		root/usr/share/portal/www/portal.js
	do
		if node --check "$f" 2>/tmp/portal-check-js.$$; then
			ok "$f"
		else
			fail "$f"
			cat /tmp/portal-check-js.$$ >&2
		fi
	done
	rm -f /tmp/portal-check-js.$$
fi

# ---------------------------------------------------------------- JSON
# The menu registration and the rpcd ACL. Both are consumed by LuCI/rpcd at
# runtime: a syntax error there is invisible until the page fails to load, and
# an ACL error shows up only as "Access denied" in the browser.
note "JSON"
for f in \
	root/usr/share/luci/menu.d/luci-app-portal.json \
	root/usr/share/rpcd/acl.d/luci-app-portal.json
do
	if python3 -m json.tool "$f" >/dev/null 2>&1; then
		ok "$f"
	else
		fail "$f is not valid JSON"
	fi
done

# ---------------------------------------------------------------- shell
note "shell"
if command -v shellcheck >/dev/null 2>&1; then
	if shellcheck -s sh root/etc/init.d/portal; then
		ok "root/etc/init.d/portal"
	else
		fail "root/etc/init.d/portal"
	fi
else
	printf '  skip  shellcheck not installed (CI installs it; see build.yml)\n'
	# A missing shellcheck must not read as a pass, but it also must not fail
	# a contributor who only has a bare shell. The syntax check below still
	# runs, so the gate degrades rather than disappears.
	sh -n root/etc/init.d/portal || fail "root/etc/init.d/portal does not parse"
fi

# ---------------------------------------------------------------- translations
# msgfmt --check reports malformed format strings and fuzzy/untranslated
# entries, which LuCI would render as broken buttons at runtime.
note "translations"
if command -v msgfmt >/dev/null 2>&1; then
	if msgfmt --check -o /dev/null po/zh_Hans/portal.po; then
		ok "po/zh_Hans/portal.po"
	else
		fail "po/zh_Hans/portal.po"
	fi
else
	printf '  skip  msgfmt not installed (gettext)\n'
fi

# ---------------------------------------------------------------- ubus <-> ACL
# The security-relevant cross-reference: every method portal.uc exposes must be
# listed in the ACL, otherwise the view silently gets "Access denied". Checking
# it here turns a runtime-only failure into a build failure.
note "ubus methods are covered by the ACL"
# portal.uc exposes its methods through the `const methods = { name: { call: …
# } }` table at the end of the file, so read the names from there rather than
# from call sites or comments.
methods=$(sed -n '/^const methods = {/,/^};/p' root/usr/share/rpcd/ucode/portal.uc |
	sed -n 's/^[[:space:]]*\([a-z_][a-z_0-9]*\):[[:space:]]*{.*/\1/p' | sort -u)
if [ -z "$methods" ]; then
	fail "could not read the method table from portal.uc (expected \`const methods = { … }\`)"
else
	acl=$(cat root/usr/share/rpcd/acl.d/luci-app-portal.json)
	for m in $methods; do
		if printf '%s' "$acl" | grep -q "\"$m\""; then
			ok "luci.portal.$m"
		else
			fail "luci.portal.$m is exposed by portal.uc but absent from the ACL"
		fi
	done
fi

# ---------------------------------------------------------------- rpc call sites
# Every rpc.declare() in this app uses the array form of `params`, which maps
# the arguments positionally - `params: [ 'dir', 'name' ]` means the call has to
# be fn(dir, name). An object argument is silently taken as the first parameter
# itself, so the request ends up as { dir: { ... } } with no name, and ubus
# rejects it with UBUS_STATUS_INVALID_ARGUMENT. The view used to report that
# rejection as a success, so this is worth a build failure rather than a device
# test. Declared methods are the `call*` bindings by convention.
note "rpc call sites pass positional arguments"
objcalls=$(grep -rnE 'call[A-Z][A-Za-z0-9_]*\(\{' \
	htdocs/luci-static/resources 2>/dev/null || true)
if [ -n "$objcalls" ]; then
	printf '%s\n' "$objcalls" >&2
	fail "an rpc call passes an object to an array-style params declaration"
else
	ok "no object arguments to declared rpc methods"
fi

# ---------------------------------------------------------------- line endings
# .gitattributes forces LF in the index. A CRLF shell script breaks on the
# device with "bad interpreter", so a CRLF working tree is worth failing on.
note "line endings"
crlf=$(git ls-files --eol 2>/dev/null | grep -c 'w/crlf' || true)
if [ "${crlf:-0}" -eq 0 ]; then
	ok "all tracked files are LF in the working tree"
else
	fail "$crlf tracked file(s) are CRLF in the working tree; run: git add --renormalize ."
fi

# ---------------------------------------------------------------- placeholders
# This repository was generated from ai-template-repository. A leftover
# {{PLACEHOLDER}} means a file escaped the fill-in step.
#
# docs/configuration.md is excluded on purpose: it documents the placeholder
# syntax, so it necessarily contains the literal and would match itself.
note "template placeholders"
ph_files=$(grep -rln '{{' \
	--include='*.md' --include='*.js' --include='*.uc' --include='*.json' \
	--exclude-dir=.git --exclude-dir=dist . 2>/dev/null | grep -v 'docs/configuration.md' || true)
if [ -n "$ph_files" ]; then
	printf '%s\n' "$ph_files" >&2
	grep -n '{{' $(printf '%s' "$ph_files" | tr '\n' ' ') >&2 || true
	fail "unresolved template placeholders in the files above"
else
	ok "none"
fi

# ---------------------------------------------------------------- verdict
printf '\n'
if [ "$failed" -ne 0 ]; then
	printf 'CHECKS FAILED\n' >&2
	exit 1
fi
printf 'ALL CHECKS PASSED\n'
