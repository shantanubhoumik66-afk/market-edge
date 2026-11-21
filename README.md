# market-edge (India_edge)

A phone-first web app for the Indian share market, hosted free on GitHub Pages and updated by GitHub Actions. Every script uses only the Python standard library, so nothing needs to be installed.

| Screen | File it reads | Built by | Schedule |
|---|---|---|---|
| India_edge (news, market breadth & sector heat, macro, RBI, government, stocks, live TV) | `data.json` | `fetch_data.py` | every 15 min |
| Watchlist (your starred stocks with price, 7-day line, matching headlines, pick badge) | `data.json`, `picks.json` | `fetch_data.py` | every 15 min |
| Evening picks | `picks.json`, `picks_history.json` | `pick_engine.py` | weekdays about 4:47 PM IST |
| Backtest | `backtest.json` | `backtest.py` | manual |
| Global_edge (world news, videos, live channels) | `global.json` | `global_edge.py` | every 30 min |

## Speed
All scripts download in parallel (`pmap` in `fetch_data.py`, 6–10 threads), so a run takes seconds to a couple of minutes instead of many minutes. `data.json` is written compact to keep the phone download small. In the app, two screens asking for the same file share one download, and the 5-minute auto-refresh only redraws a screen when its data actually changed.

## Watchlist
Tap ☆ next to any stock (Market tab, Watchlist search, or an evening pick). The list is saved on this phone only (browser storage).

## How picks are scored
Each stock gets six layers: company news, sector news, chart trend, strength vs Nifty, volume, and market trend. The top 3 on each side are published.

Each pick is saved against the **market close it was built on** (`base_date`). It is then scored on the next session in two ways:
- close → next close (`hit`)
- next open → next close (`oc_hit`), which is the trade you can actually take after reading the picks.

The picks screen shows whether the hit rate is distinguishable from a coin flip (z-score), how each layer performs, and with-trend vs against-trend results.

## Refresh data by hand
GitHub → **Actions** → choose the workflow → **Run workflow**.

## Notes
- GitHub often starts scheduled jobs late. The app shows a warning when data is older than it should be.
- `sw.js` makes the app installable (Add to Home screen) and lets it show the last data while offline. After changing `index.html`, bump `VERSION` in `sw.js`.
- This is a news and price scoring tool, not investment advice.
