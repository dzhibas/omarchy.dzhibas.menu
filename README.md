# Supercharged Omarchy Menu

A fork of the Omarchy command menu that answers questions instead of only
finding commands.

The stock menu is a launcher: you type, it filters, you pick. Everything below
is what this fork adds on top — searches that come back with an **answer** at
the head of the list. Enter copies it, or acts on it. Everything the stock menu
does (apps, themes, system commands, all of `omarchy-menu.jsonc`) still works
exactly as before.

## Features

### Open links and search the web

| Type | Get |
| --- | --- |
| `github.com/dzhibas` | Opens it in your browser |
| `https://claude.ai/code` | Opens it |
| `localhost:3000` | Opens it |
| *anything with no matches* | **Search the web** — no more dead-end "No matches" |

Bare domains are recognised only for known top-level domains, so `MenuModel.js`
and `install.sh` stay ordinary searches. Links open with
`omarchy-launch-browser`, which resolves your default browser and focuses the
window. Web search goes to DuckDuckGo — change `webSearchTemplate` in
`Menu.qml` for anything else.

### Unit conversion

| Type | Get |
| --- | --- |
| `100 km to miles` | `62.1371 mi` |
| `20 c to f` | `68 °F` |
| `5 gb to mb` | `5000 MB` |
| `1 tb to gib` | `931.323 GiB` |
| `70 kg to lb` | `154.324 lb` |
| `2 cup to ml` | `473.176 ml` |

Length, mass, volume, temperature, data, speed, time and area. Data covers both
the decimal (`kb mb gb tb`) and binary (`kib mib gib tib`) ladders, because the
difference between them is most of why anyone asks. Units take their full names
too — `miles`, `pounds`, `celsius`, `kilometres`. No network, no cache.

### Time zones

| Type | Get |
| --- | --- |
| `time in tokyo` | `18:13` · `Asia/Tokyo · 6 hours ahead` |
| `now in utc` | `09:13` · `UTC · 3 hours behind` |
| `time in pst` | `02:13` · `America/Los_Angeles · 10 hours behind` |

Any city the system knows — the zone list comes from `timedatectl` — plus the
usual abbreviations (`utc`, `cet`, `est`, `pst`, `ist`, `jst`, `aest`). The day
is shown alongside the time when it isn't today's.

### Developer utilities

| Type | Get |
| --- | --- |
| `uuid` | A random UUID v4 |
| `password 24` | A 24-character password |
| `sha256 omarchy` | `382a803dcc0de9…` |
| `base64 hello world` | `aGVsbG8gd29ybGQ=` |
| `b64d aGVsbG8=` | `hello` |
| `urlencode a b&c` | `a%20b%26c` |
| `urldecode a%20b` | `a b` |
| `epoch` | Current epoch seconds |
| `epoch 1787875351` | `Fri 28 Aug 2026 03:02:31` |

Keywords: `uuid` `password` `sha256` `base64` `b64` `b64d` `unbase64`
`urlencode` `urldecode` `epoch`.

Random bytes come from `/dev/urandom`, not `Math.random`, so `password` is
worth trusting. The answer holds still while you finish typing and is new the
next time you open the menu.

### Kill a process

| Type | Get |
| --- | --- |
| `kill chromium` | The matching processes, with pid, CPU and memory |

Enter sends `SIGTERM`. Nothing runs `ps` until `kill` is typed, and the listing
is reused for a few seconds rather than re-run on every keystroke.

### Calculator

| Type | Get |
| --- | --- |
| `2+3` | `5` |
| `sqrt(144)+2^8` | `268` |
| `(1920*1080)/2` | `1036800` |

Operators `+ - * / % ^`, parentheses, unary signs, the constants `pi` `tau` `e`,
and the functions `sqrt cbrt abs round floor ceil exp ln log log2 sin cos tan
asin acos atan`.

The expression is parsed by hand rather than handed to the JavaScript engine
that runs your shell — nothing typed into the search field is ever evaluated as
code. A bare number stays a search term.

### Currency conversion

| Type | Get |
| --- | --- |
| `123 eur to usd` | `143.31 USD` · `123 EUR at 1.1651 · 28 Aug` |
| `123USD to eur` | `105.57 EUR` |
| `$120 to eur` | `102.99 EUR` |
| `50 euros to dollars` | `58.26 USD` |
| `(20+5) eur to usd` | `29.13 USD` |
| `eur to usd` | Today's rate for one unit |

166 currencies, any pair. Codes, symbols (`$ € £ ¥ ₹ ₽ ₴ zł`) and names all
work, and the amount can be any expression the calculator understands.

Rates come from [exchangerate-api's free daily
endpoint](https://open.er-api.com/v6/latest/EUR) — no API key — and are cached
at `~/.cache/omarchy/menu-exchange-rates.json`. **The fetch happens the first
time you actually type a conversion**, so a menu never used as a converter
never touches the network; after that it refreshes about once a day. Offline,
the row says so rather than showing a stale number without warning.

Commas are not accepted in amounts: `1,000` means one thousand in half of
Europe and one-point-nought in the other half, and neither reading is worth
guessing at. Crypto is not supported — the rate source is fiat only.

## Install

```bash
omarchy plugin install https://github.com/dzhibas/omarchy.dzhibas.menu
omarchy restart shell
