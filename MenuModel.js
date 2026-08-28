function stripJsonc(raw) {
  return String(raw || "")
    .replace(/^\s*\/\/[^\n]*(\n|$)/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
}

function normalizeAliases(value) {
  if (Array.isArray(value)) return value.filter(function(v) { return v })
  if (typeof value === "string" && value) return [value]
  return []
}

function normalizeItem(id, raw) {
  var value = raw || {}
  var aliases = normalizeAliases(value.aliases)
  var parent = value.parent
  if (parent === undefined)
    parent = id.indexOf(".") >= 0 ? id.split(".").slice(0, -1).join(".") : "root"
  if (id === "root") parent = ""

  var kind = value.action ? "action" : (value.target ? "link" : "menu")

  return {
    id: id,
    parent: parent,
    kind: kind,
    icon: value.icon || "",
    iconFont: value.iconFont || "",
    label: value.label || id,
    title: value.title || "",
    target: value.target || "",
    description: value.description || "",
    action: value.action || "",
    provider: value.provider || "",
    aliases: aliases,
    when: value.when || "",
    checked: value.checked || "",
    disabled: value.disabled || ""
  }
}

function parseMenuJsonc(raw) {
  var stripped = stripJsonc(raw)
  if (!stripped.trim()) return []

  var parsed
  try {
    parsed = JSON.parse(stripped)
  } catch (e) {
    return []
  }
  if (typeof parsed !== "object" || parsed === null) return []

  var source = (parsed.items && typeof parsed.items === "object" && !Array.isArray(parsed.items))
    ? parsed.items
    : parsed
  var out = []
  for (var id in source) {
    var entry = source[id]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    out.push(normalizeItem(id, entry))
  }
  return out
}

function mergeMenuSources(defaultItems, userItems) {
  var nextItems = ({})
  var nextOrder = []
  var sources = [defaultItems || [], userItems || []]

  for (var s = 0; s < sources.length; s++) {
    var src = sources[s]
    for (var i = 0; i < src.length; i++) {
      var entry = src[i]
      if (!entry || !entry.id) continue
      if (!nextItems[entry.id]) nextOrder.push(entry.id)
      var prior = nextItems[entry.id] || {}
      var merged = {}
      for (var k in prior) merged[k] = prior[k]
      for (var k2 in entry) merged[k2] = entry[k2]
      merged.id = entry.id
      nextItems[entry.id] = merged
    }
  }

  if (!nextItems.root) {
    nextItems.root = { id: "root", parent: "", kind: "menu", icon: "", iconFont: "", label: "Go", title: "", target: "", description: "", aliases: [], when: "", checked: "", disabled: "", action: "", provider: "" }
    nextOrder.unshift("root")
  }
  for (var k3 = 0; k3 < nextOrder.length; k3++) nextItems[nextOrder[k3]].order = k3

  return {
    items: nextItems,
    itemOrder: nextOrder
  }
}

// Both merges below return fresh items/itemOrder objects for the caller to
// assign in one go. They must never write into the maps they are handed: those
// live in QML `var` properties, and an in-place write into such an object is
// occasionally dropped by the engine — the key lands with an undefined value.
// A lost write used to leave an id in itemOrder with no item behind it, and
// the next merge then kept that orphan and appended a second row for the same
// app, so the launcher listed it twice (and again on every later rescan).

// Swaps every app row for the current set. Rows keep the order they arrive in;
// ids already claimed (including duplicate desktop ids) are listed once.
function mergeAppRows(items, itemOrder, appRows) {
  var source = items || ({})
  var order = Array.isArray(itemOrder) ? itemOrder : []
  var rows = Array.isArray(appRows) ? appRows : []
  var nextItems = ({})
  var nextOrder = []

  for (var i = 0; i < order.length; i++) {
    var id = order[i]
    var existing = source[id]
    // Orphans (an id with no item) are dropped rather than carried forward,
    // so a single lost write cannot compound into a duplicate row.
    if (!existing || existing.kind === "app") continue
    nextItems[id] = existing
    nextOrder.push(id)
  }

  for (var j = 0; j < rows.length; j++) {
    var row = rows[j]
    if (!row || !row.id || nextItems[row.id]) continue
    row.order = nextOrder.length
    nextItems[row.id] = row
    nextOrder.push(row.id)
  }

  return { items: nextItems, itemOrder: nextOrder }
}

// Swaps the rows one provider contributed, leaving every other item untouched.
// Rows carry the id of the submenu that produced them, so a provider that runs
// again drops its previous batch — a plugin that was just enabled disappears
// from the Enable list — without disturbing static children declared in JSONC.
function swapProviderRows(items, itemOrder, menuId, rows) {
  var source = items || ({})
  var order = Array.isArray(itemOrder) ? itemOrder : []
  var incoming = Array.isArray(rows) ? rows : []
  var nextItems = ({})
  var nextOrder = []

  for (var i = 0; i < order.length; i++) {
    var id = order[i]
    var existing = source[id]
    if (!existing || existing.providerMenu === menuId) continue
    nextItems[id] = existing
    nextOrder.push(id)
  }

  for (var j = 0; j < incoming.length; j++) {
    var row = incoming[j]
    if (!row || !row.id || nextItems[row.id]) continue
    row.providerMenu = menuId
    row.order = nextOrder.length
    nextItems[row.id] = row
    nextOrder.push(row.id)
  }

  return { items: nextItems, itemOrder: nextOrder }
}

function item(items, id) {
  return items && items[id] ? items[id] : null
}

// Routes may name a real id (`system`, `setup.power`) or an alias declared in
// JSONC (`power-menu`, `settings`). An exact id beats any alias, and app rows
// are never routable: their aliases carry .desktop Keywords and GenericName
// for search, so an installed application could otherwise shadow a menu route
// (htop ships `Keywords=system;...`). Unknown strings fall through as the
// literal input so misspellings still attempt to open that id.
function resolveRoute(items, itemOrder, input) {
  var raw = String(input || "").toLowerCase().replace(/_/g, "-")
  if (!raw || raw === "go" || raw === "menu") return "root"
  if (item(items, raw)) return raw
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var entry = item(items, order[i])
    if (!entry || entry.kind === "app" || !entry.aliases) continue
    for (var j = 0; j < entry.aliases.length; j++) {
      var alias = String(entry.aliases[j] || "").toLowerCase().replace(/_/g, "-")
      if (alias === raw) return entry.id
    }
  }
  return raw
}

function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item"
}

function depthFor(items, id) {
  var depth = 0
  var current = item(items, id)
  var guard = 0

  while (current && current.parent && current.parent !== "root" && guard < 32) {
    depth += 1
    current = item(items, current.parent)
    guard += 1
  }

  return depth
}

function pathFor(items, id) {
  var labels = []
  var current = item(items, id)
  var guard = 0

  while (current && current.id !== "root" && guard < 32) {
    labels.unshift(current.label)
    current = item(items, current.parent)
    guard += 1
  }

  return labels.join(" › ")
}

function parentPathFor(items, id) {
  var entry = item(items, id)
  if (!entry || !entry.parent || entry.parent === "root") return ""
  return pathFor(items, entry.parent)
}

function isDescendantOf(items, id, ancestorId) {
  if (ancestorId === "root") return id !== "root"

  var current = item(items, id)
  var guard = 0
  while (current && current.parent && guard < 32) {
    if (current.parent === ancestorId) return true
    current = item(items, current.parent)
    guard += 1
  }

  return false
}

function childCount(items, itemOrder, id) {
  var count = 0
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var entry = item(items, order[i])
    if (entry && entry.parent === id) count += 1
  }
  return count
}

function isVisible(items, itemOrder, whenResults, entry, depth) {
  if (!entry) return false
  if (entry.when && whenResults && whenResults[entry.id] === false) return false
  if (entry.kind !== "menu" && entry.kind !== "link") return true
  if (entry.provider) return true

  var guard = depth || 0
  if (guard >= 32) return false

  var target = entry.kind === "link" ? entry.target : entry.id
  var order = Array.isArray(itemOrder) ? itemOrder : []
  for (var i = 0; i < order.length; i++) {
    var child = item(items, order[i])
    if (child && child.parent === target && isVisible(items, itemOrder, whenResults, child, guard + 1)) return true
  }

  return false
}

// A `disabled:` row stays listed but goes dim and unselectable. The
// Install submenus use it so software already on the machine reads as
// installed rather than disappearing from the list it was installed from.
function isDisabled(disabledResults, entry) {
  if (!entry || !entry.disabled) return false
  return !!(disabledResults && disabledResults[entry.id])
}

// A disabled row is software you already have, which is the same thing the ✓
// says everywhere else in the menu, so it earns the same marker.
function labelFor(entry, checkedResults, disabledResults) {
  if (!entry) return ""
  var marked = (entry.checked && checkedResults && checkedResults[entry.id]) || isDisabled(disabledResults, entry)
  return marked ? entry.label + " ✓" : entry.label
}

function searchableToken(value) {
  return String(value || "").replace(/[._-]+/g, " ")
}

function leafIdFor(id) {
  var parts = String(id || "").split(".")
  return parts.length > 0 ? parts[parts.length - 1] : id
}

function nameSearchText(entry) {
  if (!entry) return ""
  var aliases = []
  var values = Array.isArray(entry.aliases) ? entry.aliases : []
  for (var i = 0; i < values.length; i++) aliases.push(searchableToken(values[i]))
  return [entry.label, searchableToken(leafIdFor(entry.id)), aliases.join(" ")].join(" ").toLowerCase()
}

function termInSearchWords(term, text) {
  var words = String(text || "").toLowerCase().split(/\s+/)
  for (var i = 0; i < words.length; i++) {
    if (words[i] === term) return true
  }
  return false
}

function descriptionTextMatches(query, text) {
  var terms = String(query || "").toLowerCase().trim().split(/\s+/)
  for (var i = 0; i < terms.length; i++) {
    if (terms[i] && !termInSearchWords(terms[i], text)) return false
  }
  return true
}

function matchesQuery(entry, query, visible) {
  if (!entry || entry.id === "root") return false
  if (!visible) return false

  var nameText = nameSearchText(entry)
  var descriptionText = String(entry.description || "").toLowerCase()
  var terms = String(query || "").toLowerCase().trim().split(/\s+/)

  for (var i = 0; i < terms.length; i++) {
    if (!terms[i]) continue
    if (nameText.indexOf(terms[i]) >= 0) continue
    if (termInSearchWords(terms[i], descriptionText)) continue
    return false
  }

  return true
}

function searchScore(items, entry, query) {
  var needle = String(query || "").toLowerCase().trim()
  var label = entry.label.toLowerCase()
  var nameText = nameSearchText(entry)
  var descriptionText = String(entry.description || "").toLowerCase()
  var score = 80

  if (label === needle) score = entry.parent === "root" ? 2 : 0
  // An installed app whose name contains the query as a whole word ("zen"
  // for Zen Browser) beats exact-labeled menu entries like Install > Zen.
  else if (entry.kind === "app" && label.split(/\s+/).indexOf(needle) >= 0) score = 0
  else if (label.indexOf(needle) === 0) score = 10
  else if (label.indexOf(needle) >= 0) score = 30
  else if (nameText.indexOf(needle) >= 0) score = 40
  else if (descriptionTextMatches(needle, descriptionText)) score = 60

  if (entry.kind === "menu" || entry.kind === "link") score -= 2
  // App rows sort after all menu items, so they lose the tiebreak below to an
  // equal match. Outrank those, but stay inside the tier so better ones win.
  if (entry.kind === "app") score -= 5

  return score * 1000 + depthFor(items, entry.id) * 25 + entry.order
}

function displayRow(items, itemOrder, checkedResults, disabledResults, entry, detail, score, section) {
  var target = entry.kind === "link" ? entry.target : entry.id
  return {
    itemId: entry.id,
    disabled: isDisabled(disabledResults, entry),
    kind: entry.kind,
    icon: entry.icon,
    iconFont: entry.iconFont || "",
    appIcon: entry.appIcon || "",
    appId: entry.appId || "",
    label: labelFor(entry, checkedResults, disabledResults),
    target: target,
    detail: detail || "",
    path: pathFor(items, entry.id),
    childCount: (entry.kind === "menu" || entry.kind === "link") ? childCount(items, itemOrder, target) : 0,
    action: entry.action || "",
    provider: entry.provider || "",
    score: score || 0,
    section: section || ""
  }
}

// Commands a `checked:` expression reads a value out of. Every sibling row
// asks the same one -- Defaults > Browser has seven rows all comparing
// against `omarchy-default-browser` -- so the batch runs it once and the rows
// read the captured answer.
//
// The capture has to be eager. These are read inside `$(...)`, and a value
// cached while one expression runs lives in that subshell only, so a lazy
// memo never survives to the expression after it.
var GUARD_READERS = [
  "omarchy-channel-current",
  "omarchy-default-agent",
  "omarchy-default-browser",
  "omarchy-default-editor",
  "omarchy-default-terminal",
  "omarchy-dns"
]

// Package and command presence account for most of what the guards ask, and
// asked one at a time they are almost all fork: the shipped menu spends over
// a second on them. Answer them inside the guard process instead. These
// shadow the real commands for the batch only, so they have to agree with
// them everywhere, including for no arguments at all (present is true of
// nothing, missing is not).
//
// `pacman -Q` resolves a name through what installed packages provide, not
// just what they are called -- with gvim installed it reports `vim` as
// present -- so the set has to carry provides too, or `install.editor.vim`
// comes back and offers to install what is already there. A version
// constraint (`bash>=1`) is not a name any set can answer, so it goes to
// pacman itself; no shipped guard writes one.
//
// `pacman -Qi` wraps a long list across continuation lines whenever COLUMNS
// is set in the environment, which a login shell may well have done, so the
// parser follows the indented lines rather than reading the first one and
// dropping half of what is installed.
function guardHelpers() {
  return 'declare -A __omarchy_pkgs=()\n'
    + 'mapfile -t __omarchy_pkg_names < <({ pacman -Qq; LC_ALL=C pacman -Qi'
    + " | awk '/^[A-Za-z]/ { provides = ($0 ~ /^Provides/); sub(/^[^:]*: /, \"\") }"
    + ' provides && $0 != "None" { n = split($0, p, " ");'
    + ' for (i = 1; i <= n; i++) { sub(/[<>=].*/, "", p[i]); print p[i] } }\'; } 2>/dev/null)\n'
    + 'for __omarchy_pkg in "${__omarchy_pkg_names[@]}"; do __omarchy_pkgs[$__omarchy_pkg]=1; done\n'
    + '__omarchy_pkg_has() { [[ -n ${__omarchy_pkgs[$1]-} ]] && return 0; '
    + '[[ $1 == *[\\<\\>=]* ]] && { pacman -Q "$1" &>/dev/null; return; }; return 1; }\n'
    + 'omarchy-pkg-present() { local p; for p in "$@"; do __omarchy_pkg_has "$p" || return 1; done; return 0; }\n'
    + 'omarchy-pkg-missing() { local p; for p in "$@"; do __omarchy_pkg_has "$p" || return 0; done; return 1; }\n'
    + 'omarchy-cmd-present() { local c; for c in "$@"; do command -v "$c" &>/dev/null || return 1; done; return 0; }\n'
    + 'omarchy-cmd-missing() { local c; for c in "$@"; do command -v "$c" &>/dev/null || return 0; done; return 1; }\n'
}

// Substitute the captured answer into the expression rather than shadowing
// the reader with a function. `$(reader)` and the variable holding what it
// printed are interchangeable -- both strip trailing newlines, both split the
// same way unquoted -- while a function would also catch `command -v reader`,
// `VAR=x reader`, and every other form, and answer those wrong. Anything but
// the plain substitution is left alone to run the real command.
function guardPrelude(guards) {
  var prelude = guardHelpers()

  for (var i = 0; i < GUARD_READERS.length; i++) {
    // The guards arrive already substituted, so what marks a reader as wanted
    // is the slot standing in for it, not the call it replaced.
    if (guards.indexOf(guardReaderSlot(i)) < 0) continue
    // `|| :` so a reader that exits nonzero cannot take the batch down with
    // it under a login shell that turned on errexit.
    prelude += "__omarchy_read_" + i + "=$(" + GUARD_READERS[i] + " 2>/dev/null) || :\n"
  }

  return prelude
}

function guardReaderSlot(index) {
  return "${__omarchy_read_" + index + "}"
}

function substituteGuardReaders(expression) {
  for (var i = 0; i < GUARD_READERS.length; i++)
    expression = expression.split("$(" + GUARD_READERS[i] + ")").join(guardReaderSlot(i))

  return expression
}

function guardLine(id, tag, expression) {
  return "if { " + substituteGuardReaders(expression) + "; } >/dev/null 2>&1; then echo "
    + id + ":" + tag + ":1; else echo " + id + ":" + tag + ":0; fi\n"
}

// One bash script for every `when:`, `checked:` and `disabled:` in the menu,
// reporting `<id>:<w|c|d>:<0|1>` per line. Speed is the whole point: the menu
// opens on the last evaluation's answers, so however long this takes is how
// long a row can contradict the state it describes.
function guardScript(items) {
  var guards = ""
  var ids = Object.keys(items || {})

  for (var i = 0; i < ids.length; i++) {
    var entry = items[ids[i]]
    if (!entry) continue
    if (entry.when) guards += guardLine(ids[i], "w", entry.when)
    if (entry.checked) guards += guardLine(ids[i], "c", entry.checked)
    if (entry.disabled) guards += guardLine(ids[i], "d", entry.disabled)
  }

  return guards ? guardPrelude(guards) + guards : ""
}

// --- Calculator -------------------------------------------------------------
// A search that reads as arithmetic ("2+3", "3.23 + 343", "(4+6)/2") answers
// itself, so the menu doubles as a pocket calculator. The expression is parsed
// by hand rather than handed to the JS engine: the input is whatever the user
// typed, and nothing typed into a search field should be able to reach the
// engine that runs the shell.
var MATH_CONSTANTS = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E
}

var MATH_FUNCTIONS = {
  sqrt: function(x) { return Math.sqrt(x) },
  cbrt: function(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3) },
  abs: function(x) { return Math.abs(x) },
  round: function(x) { return Math.round(x) },
  floor: function(x) { return Math.floor(x) },
  ceil: function(x) { return Math.ceil(x) },
  exp: function(x) { return Math.exp(x) },
  ln: function(x) { return Math.log(x) },
  // Math.log10/log2 postdate the ES5 baseline this file otherwise sticks to.
  log: function(x) { return Math.log(x) / Math.LN10 },
  log2: function(x) { return Math.log(x) / Math.LN2 },
  sin: function(x) { return Math.sin(x) },
  cos: function(x) { return Math.cos(x) },
  tan: function(x) { return Math.tan(x) },
  asin: function(x) { return Math.asin(x) },
  acos: function(x) { return Math.acos(x) },
  atan: function(x) { return Math.atan(x) }
}

function mathHas(table, name) {
  return Object.prototype.hasOwnProperty.call(table, name)
}

// Anything the grammar does not name is a tokenize failure rather than a
// character to skip: a query is only ever an expression if all of it is one.
// Commas included -- "1,5" is five hundred short of a thousand in half of
// Europe, so neither reading is worth guessing at.
function tokenizeMath(text) {
  var src = String(text || "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
  var tokens = []
  var i = 0

  while (i < src.length) {
    var ch = src.charAt(i)

    if (ch === " " || ch === "\t") { i += 1; continue }

    if (/[0-9.]/.test(ch)) {
      var number = ""
      while (i < src.length && /[0-9.]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
      if (/^[eE]/.test(src.charAt(i)) && /[0-9+-]/.test(src.charAt(i + 1))) {
        number += src.charAt(i); i += 1
        if (/[+-]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
        while (i < src.length && /[0-9]/.test(src.charAt(i))) { number += src.charAt(i); i += 1 }
      }
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(number)) return null
      tokens.push({ type: "number", value: parseFloat(number) })
      continue
    }

    if (/[a-zA-Z]/.test(ch)) {
      var name = ""
      while (i < src.length && /[a-zA-Z0-9]/.test(src.charAt(i))) { name += src.charAt(i); i += 1 }
      tokens.push({ type: "name", value: name.toLowerCase() })
      continue
    }

    if ("+-*/%^()".indexOf(ch) >= 0) { tokens.push({ type: ch }); i += 1; continue }

    return null
  }

  return tokens
}

// Evaluates while it parses -- there is no tree to keep, one expression is
// answered per keystroke, and a null anywhere means "not arithmetic" and stops
// the whole thing. `operators` counts the work done, so a bare number stays a
// search term instead of turning into a result row for itself.
function parseMathTokens(tokens) {
  var pos = 0
  var operators = 0

  function peek() { return pos < tokens.length ? tokens[pos] : null }

  function eat(type) {
    var token = peek()
    if (!token || token.type !== type) return null
    pos += 1
    return token
  }

  function parseExpression() {
    var left = parseTerm()
    if (left === null) return null

    for (;;) {
      var token = peek()
      if (!token || (token.type !== "+" && token.type !== "-")) return left
      pos += 1
      operators += 1
      var right = parseTerm()
      if (right === null) return null
      left = token.type === "+" ? left + right : left - right
    }
  }

  function parseTerm() {
    var left = parseUnary()
    if (left === null) return null

    for (;;) {
      var token = peek()
      if (!token || (token.type !== "*" && token.type !== "/" && token.type !== "%")) return left
      pos += 1
      operators += 1
      var right = parseUnary()
      if (right === null) return null
      if (token.type === "*") left = left * right
      else if (token.type === "/") left = left / right
      else left = left % right
    }
  }

  function parseUnary() {
    var token = peek()
    if (token && (token.type === "+" || token.type === "-")) {
      pos += 1
      var operand = parseUnary()
      if (operand === null) return null
      return token.type === "-" ? -operand : operand
    }
    return parsePower()
  }

  // Right-associative, and the exponent takes a sign of its own: 2^-3.
  function parsePower() {
    var base = parseAtom()
    if (base === null) return null
    if (!peek() || peek().type !== "^") return base
    pos += 1
    operators += 1
    var exponent = parseUnary()
    if (exponent === null) return null
    return Math.pow(base, exponent)
  }

  function parseAtom() {
    if (eat("(")) {
      var grouped = parseExpression()
      if (grouped === null || !eat(")")) return null
      return grouped
    }

    var number = eat("number")
    if (number) return number.value

    var name = eat("name")
    if (!name) return null
    if (mathHas(MATH_CONSTANTS, name.value)) return MATH_CONSTANTS[name.value]
    if (!mathHas(MATH_FUNCTIONS, name.value)) return null
    if (!eat("(")) return null
    var argument = parseExpression()
    if (argument === null || !eat(")")) return null
    operators += 1
    return MATH_FUNCTIONS[name.value](argument)
  }

  var value = parseExpression()
  if (value === null || pos !== tokens.length) return null
  return { value: value, operators: operators }
}

// Binary floating point leaves 0.1 + 0.2 at 0.30000000000000004. Twelve
// significant digits is past anything typed by hand and short of the noise.
function formatMathResult(value) {
  if (typeof value !== "number" || !isFinite(value)) return ""

  var text = value.toPrecision(12)
  if (text.indexOf("e") >= 0) return String(parseFloat(text))
  if (text.indexOf(".") >= 0) text = text.replace(/0+$/, "").replace(/\.$/, "")
  // -0 reads as a typo, not an answer.
  return text === "-0" ? "0" : text
}

// The formatted answer for a query that is entirely an expression, or "" for
// one that is not -- including a bare number, which is still a search.
function evaluateMath(query) {
  var text = String(query || "").trim()
  // Typing the `=` is how a calculator is asked, so let it mean nothing here.
  if (text.charAt(text.length - 1) === "=") text = text.slice(0, -1).trim()
  if (!text) return ""

  var tokens = tokenizeMath(text)
  if (!tokens || tokens.length === 0) return ""

  var parsed = parseMathTokens(tokens)
  if (!parsed || parsed.operators === 0) return ""
  // Division by zero and the like: an answer the row cannot honestly show.
  if (!isFinite(parsed.value)) return ""

  return formatMathResult(parsed.value)
}

// --- Currency ----------------------------------------------------------------
// "123 eur to usd" is the other search that has an obvious answer the menu can
// give, so it answers itself the way arithmetic does: the conversion leads the
// list and Enter copies it. The rates behind it are a daily snapshot cached on
// disk, fetched the first time somebody actually asks for a conversion -- a
// menu never used as a converter never reaches the network.

// ISO 4217 codes the rate source carries. Static rather than read off the
// cached rates: a query has to be recognised as a conversion before there is
// anything cached to recognise it against, since recognising it is what asks
// for the fetch.
var CURRENCY_CODES = (
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND " +
  "BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLF CLP CNH CNY COP CRC CUP CVE " +
  "CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP FOK GBP GEL GGP GHS GIP GMD " +
  "GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS IMP INR IQD IRR ISK JEP JMD JOD " +
  "JPY KES KGS KHR KID KMF KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL " +
  "MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD " +
  "OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK " +
  "SGD SHP SLE SLL SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TVD " +
  "TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF YER " +
  "ZAR ZMW ZWG ZWL"
).split(" ")

var CURRENCY_CODE_SET = (function() {
  var set = {}
  for (var i = 0; i < CURRENCY_CODES.length; i++) set[CURRENCY_CODES[i]] = true
  return set
})()

// Only symbols with one sensible reading. "$" is claimed by a dozen dollars
// and "kr" by four kronor; the bare ones go to the currency that owns them in
// ordinary use, and the ambiguous rest are left to be spelled as codes.
var CURRENCY_SYMBOLS = {
  "$": "USD", "us$": "USD", "usd$": "USD",
  "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₽": "RUB", "₴": "UAH",
  "₺": "TRY", "₩": "KRW", "₪": "ILS", "฿": "THB", "₫": "VND", "₱": "PHP",
  "₦": "NGN", "₸": "KZT", "₮": "MNT", "₾": "GEL", "₼": "AZN", "₵": "GHS",
  "₲": "PYG", "៛": "KHR", "zł": "PLN", "kč": "CZK",
  "r$": "BRL", "c$": "CAD", "a$": "AUD", "nz$": "NZD", "hk$": "HKD", "s$": "SGD"
}

// Typing the name instead of the code is the same question.
var CURRENCY_WORDS = {
  euro: "EUR", euros: "EUR",
  dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD",
  pound: "GBP", pounds: "GBP", sterling: "GBP", quid: "GBP",
  yen: "JPY", yuan: "CNY", rmb: "CNY",
  rupee: "INR", rupees: "INR",
  ruble: "RUB", rubles: "RUB", rouble: "RUB", roubles: "RUB",
  franc: "CHF", francs: "CHF",
  zloty: "PLN", zlotys: "PLN",
  won: "KRW", shekel: "ILS", shekels: "ILS",
  hryvnia: "UAH", lira: "TRY", rand: "ZAR", baht: "THB"
}

function currencyHas(table, name) {
  return Object.prototype.hasOwnProperty.call(table, name)
}

// A code, a symbol or a name, however it was capitalised -- or "" for a word
// that is none of them, which is how a plain search stays a plain search.
function currencyCodeFor(token) {
  var raw = String(token || "").trim()
  if (!raw) return ""

  var lower = raw.toLowerCase()
  if (currencyHas(CURRENCY_SYMBOLS, lower)) return CURRENCY_SYMBOLS[lower]
  if (currencyHas(CURRENCY_WORDS, lower)) return CURRENCY_WORDS[lower]

  var upper = raw.toUpperCase()
  return currencyHas(CURRENCY_CODE_SET, upper) ? upper : ""
}

// The target is the tail after "to"/"in"/"into"/"as"/"->", or just the last
// word when the connector is left out ("120 usd eur"). The head is greedy, so
// a query with more than one "to" in it splits on the last one.
function splitCurrencyQuery(text) {
  var connected = text.match(/^(.*\S)(?:\s+(?:to|into|in|as)\s+|\s*(?:->|=>|→)\s*)(\S.*)$/i)
  if (connected) return { head: connected[1].trim(), to: connected[2].trim() }

  var bare = text.match(/^(.*\S)\s+(\S+)$/)
  if (bare) return { head: bare[1].trim(), to: bare[2].trim() }

  return null
}

// The source currency sits on either side of the amount: "$120", "120 eur",
// "120eur", "usd 120". A head that is only a currency converts one unit of it,
// which is how a rate gets looked up without inventing an amount to look it
// up with.
//
// Both readings are offered rather than picked, because either can be the one
// that is a currency at all: the trailing word in "sqrt(4) eur", the leading
// one in "usd 100". The caller keeps the first that names a currency.
function currencyHeadSplits(head) {
  var splits = []

  var suffixed = head.match(/^(.*?)\s*([^\s0-9.,()+\-*\/%^]+)$/)
  if (suffixed) splits.push({ code: suffixed[2], amount: suffixed[1].trim() })

  var prefixed = head.match(/^([^\s0-9.,()+\-*\/%^]+)\s*(.*)$/)
  if (prefixed) splits.push({ code: prefixed[1], amount: prefixed[2].trim() })

  return splits
}

// The amount goes through the calculator rather than parseFloat: it is the
// same grammar, it already refuses anything it does not recognise, and it
// makes "(20+5) eur to usd" work for free. A missing amount is one unit.
function currencyAmount(text) {
  var raw = String(text || "").trim()
  if (!raw) return 1

  var tokens = tokenizeMath(raw)
  if (!tokens || tokens.length === 0) return null

  var parsed = parseMathTokens(tokens)
  if (!parsed || !isFinite(parsed.value)) return null

  return parsed.value
}

// { amount, from, to } for a query that reads as a conversion, or null for one
// that does not -- which is most of them, so every step bails on the first
// thing it cannot name.
function parseCurrencyQuery(query) {
  var text = String(query || "").trim()
  if (text.charAt(text.length - 1) === "=") text = text.slice(0, -1).trim()
  if (!text) return null

  var split = splitCurrencyQuery(text)
  if (!split) return null

  var to = currencyCodeFor(split.to)
  if (!to) return null

  var splits = currencyHeadSplits(split.head)
  for (var i = 0; i < splits.length; i++) {
    var from = currencyCodeFor(splits[i].code)
    if (!from) continue

    var amount = currencyAmount(splits[i].amount)
    if (amount === null) continue

    return { amount: amount, from: from, to: to }
  }

  return null
}

// The snapshot is one base-relative table, so any cross rate is the ratio of
// two of its entries and no second request is needed to get one.
function convertCurrency(parsed, rates) {
  if (!parsed || !rates) return null

  var from = rates[parsed.from]
  var to = rates[parsed.to]
  if (typeof from !== "number" || typeof to !== "number") return null
  if (!(from > 0) || !(to > 0)) return null

  var rate = to / from
  var value = parsed.amount * rate
  if (!isFinite(value)) return null

  return { value: value, rate: rate }
}

// Money reads in two decimals. An amount that rounds away to nothing there is
// not an answer, so small ones keep digits until they say something.
function formatCurrencyValue(value) {
  if (typeof value !== "number" || !isFinite(value)) return ""

  var magnitude = Math.abs(value)
  var digits = 2
  if (magnitude > 0 && magnitude < 0.01)
    digits = Math.min(10, 2 + Math.ceil(-Math.log(magnitude) / Math.LN10))

  var text = value.toFixed(digits)
  if (digits > 2) text = text.replace(/0+$/, "").replace(/\.$/, "")
  return /^-0(\.0*)?$/.test(text) ? text.slice(1) : text
}

// The rate is a fact about the pair rather than an amount of money, so it
// keeps significant digits instead of decimal places: 0.00000123, not 0.00.
// Five of them, because it rides along in a row that is one line wide and the
// converted amount above it is where the precision actually matters.
function formatCurrencyRate(rate) {
  if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) return ""
  return String(parseFloat(rate.toPrecision(5)))
}

// Accepts what either of the usual free rate sources answers with -- the
// exchangerate-api shape (base_code, time_last_update_unix) and the
// frankfurter/ECB one (base, date) -- and normalises it to one snapshot.
function parseCurrencyRates(text) {
  var payload = null
  try { payload = JSON.parse(String(text || "")) } catch (e) { return null }
  if (!payload || !payload.rates || typeof payload.rates !== "object") return null

  var base = String(payload.base_code || payload.base || "").toUpperCase()
  var rates = {}
  var count = 0

  for (var code in payload.rates) {
    if (!Object.prototype.hasOwnProperty.call(payload.rates, code)) continue
    var value = payload.rates[code]
    if (typeof value !== "number" || !isFinite(value) || value <= 0) continue
    rates[String(code).toUpperCase()] = value
    count += 1
  }

  if (count === 0) return null
  // Sources differ on whether the base is one of its own rates. It is 1.
  if (base && !currencyHas(rates, base)) { rates[base] = 1; count += 1 }

  return {
    base: base,
    rates: rates,
    count: count,
    updated: Number(payload.time_last_update_unix) || 0,
    nextUpdate: Number(payload.time_next_update_unix) || 0,
    date: String(payload.date || "")
  }
}

// Rates move once a day. The source says when it will next publish, so honour
// that when it does and fall back to the age of what we have when it doesn't.
function currencyRatesStale(snapshot, nowSeconds) {
  if (!snapshot || !snapshot.rates || !snapshot.count) return true
  if (snapshot.nextUpdate > 0) return nowSeconds >= snapshot.nextUpdate
  if (snapshot.updated > 0) return nowSeconds - snapshot.updated >= 12 * 3600
  return true
}

if (typeof module !== "undefined") {
  module.exports = {
    guardReaders: GUARD_READERS,
    guardScript: guardScript,
    stripJsonc: stripJsonc,
    normalizeAliases: normalizeAliases,
    normalizeItem: normalizeItem,
    parseMenuJsonc: parseMenuJsonc,
    mergeMenuSources: mergeMenuSources,
    mergeAppRows: mergeAppRows,
    swapProviderRows: swapProviderRows,
    item: item,
    resolveRoute: resolveRoute,
    slugify: slugify,
    depthFor: depthFor,
    pathFor: pathFor,
    parentPathFor: parentPathFor,
    isDescendantOf: isDescendantOf,
    childCount: childCount,
    isVisible: isVisible,
    isDisabled: isDisabled,
    labelFor: labelFor,
    searchableToken: searchableToken,
    leafIdFor: leafIdFor,
    nameSearchText: nameSearchText,
    termInSearchWords: termInSearchWords,
    descriptionTextMatches: descriptionTextMatches,
    matchesQuery: matchesQuery,
    searchScore: searchScore,
    displayRow: displayRow,
    tokenizeMath: tokenizeMath,
    formatMathResult: formatMathResult,
    evaluateMath: evaluateMath,
    currencyCodeFor: currencyCodeFor,
    parseCurrencyQuery: parseCurrencyQuery,
    convertCurrency: convertCurrency,
    formatCurrencyValue: formatCurrencyValue,
    formatCurrencyRate: formatCurrencyRate,
    parseCurrencyRates: parseCurrencyRates,
    currencyRatesStale: currencyRatesStale
  }
}
