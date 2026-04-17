## Selected API

- Endpoint: `https://www.swiggy.com/dapi/restaurants/list/v5?lat=<lat>&lng=<lng>&is-seo-homepage-enabled=true&page_type=DESKTOP_WEB_LISTING`
- Method: `GET`
- Auth: none for the first SEO city payload
- Pagination: first page only over direct HTTP
- Fields available: restaurant id, name, image id, locality, area, cuisines, ratings, rating counts, delivery SLA, pricing hint, badges, discount summary, restaurant URL, current city metadata, total restaurant count hint
- Fields currently missing in actor: all Swiggy restaurant fields, city metadata, ratings, cuisines, delivery estimates, pricing hints, image ids, badges, matched-dish context for keyword runs
- Field count: well above 15 unique restaurant fields

## Secondary API

- Endpoint: `https://www.swiggy.com/dapi/restaurants/search/v3?lat=<lat>&lng=<lng>&str=<keyword>&trackingId=undefined&submitAction=ENTER`
- Method: `GET`
- Auth: none
- Pagination: no working direct continuation parameter was confirmed, but a single response already returns a large search result payload
- Fields available: dish match data plus embedded restaurant metadata for every hit
- Use in actor: keyword mode, with restaurant deduplication and matched-dish enrichment

## Browser-Assisted Fallback

- Endpoint family: `https://www.swiggy.com/dapi/restaurants/list/update?...`
- Method: `GET`
- Auth: requires browser-acquired session state; direct HTTP returned `403`
- Use in actor: Playwright Firefox is used only to capture or fetch JSON API responses after the city page is loaded. No HTML parsing is used for extraction.

## Rejected Candidates

- `urlscan.io` scan results for Swiggy landing pages were dominated by AWS WAF challenge traffic and did not expose the useful restaurant API calls directly.
- `https://www.swiggy.com/dapi/misc/place-autocomplete?...` returned an application error page in direct HTTP tests, so it was not used for location resolution.
- Direct HTTP calls to `dapi/restaurants/list/update` consistently returned `403` even when replaying session cookies and response tokens from the working first-page API.

## Why This API Won

- Returns JSON directly
- Exposes rich restaurant fields well beyond the old actor
- Supports city and keyword use cases
- Works over plain HTTP for the core data paths
- Keeps Playwright limited to browser-gated API continuation only