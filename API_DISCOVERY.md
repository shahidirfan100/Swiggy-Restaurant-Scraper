## Selected API

- Endpoint: `https://www.swiggy.com/dapi/restaurants/list/v5?lat=<lat>&lng=<lng>&is-seo-homepage-enabled=true&page_type=DESKTOP_WEB_LISTING`
- Method: `GET`
- Authentication: none for the verified SEO listing response
- Request profile: one shared `Impit` client using its Chrome browser profile; only Swiggy `Origin` and page `Referer` are added when applicable
- Pagination: the response exposes `data.pageOffset.nextOffset`, but direct offset replay was not confirmed as a continuation. The actor therefore uses the existing `maxPages` coordinate expansion and deduplicates restaurant IDs instead of issuing duplicate offset requests.
- Verified response: HTTP 200 with 8 restaurant cards in the tested first payload and 26 fields on the first restaurant `info` object
- Available data: restaurant id, name, image id, locality, area, cuisines, ratings, rating counts, delivery SLA, pricing hint, badges, discount summary, restaurant URL, city metadata, and total-count hints
- Actor output mapping: preserves the existing restaurant field names and adds the verified restaurant metadata available from the JSON cards

## Secondary API

- Endpoint: `https://www.swiggy.com/dapi/restaurants/search/v3?lat=<lat>&lng=<lng>&str=<keyword>&trackingId=undefined&submitAction=ENTER&selectedPLTab=RESTAURANT`
- Method: `GET`
- Authentication: none in the verified direct request
- Pagination: no working direct continuation parameter was confirmed; one response returned 102 restaurant cards in testing
- Verified response: HTTP 200 with 31 fields on the first restaurant-related object
- Actor use: keyword mode requests the restaurant tab at each of the existing bounded city coordinate targets, deduplicating by restaurant ID until `resultsWanted` is reached. A second `selectedPLTab=DISH` request is optional enrichment for matched dishes. If neither response contains restaurant cards, keyword mode falls back to the city listing path.
- Coverage evidence: sequential requests for the same keyword at the resolved Bangalore center, then southwest and southeast bounding-box corners returned 102, 41, and 80 additional unique restaurant IDs (223 total). Keyword fan-out prioritizes these distinct areas within the existing `maxPages` bound; this is geographic fan-out, not unverified offset pagination.

## Location Resolution

- Endpoint: `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&...`
- Method: `GET`
- Authentication: none in the verified direct request
- Actor use: resolves a Swiggy city slug or user-provided location to coordinates and, when available, a bounding box for coordinate expansion
- Verified response: HTTP 200 with coordinates for Bangalore

## Candidate Matrix

| Candidate | Status | Response / fields | Pagination | Decision |
| --- | --- | --- | --- | --- |
| `restaurants/list/v5` | HTTP 200 | Listing JSON; 8 tested restaurant cards; 26 fields on first `info` object | `nextOffset` exposed but continuation unconfirmed | **Selected primary** |
| `restaurants/search/v3` with `selectedPLTab=RESTAURANT` | HTTP 200 | Search JSON; 102 tested restaurant cards; 31 fields on first restaurant object | No working continuation confirmed | **Selected keyword path** |
| `restaurants/search/v3` with `selectedPLTab=DISH` | HTTP 200 | Dish cards containing restaurant context | No working continuation confirmed | Optional keyword enrichment only |
| `restaurants/list/update` | HTTP 403 | Requires browser-acquired session state; direct replay remained forbidden | Browser-gated | Rejected |
| `misc/place-autocomplete` | Application error page | No usable location payload in direct HTTP testing | Not applicable | Rejected |
| URLScan Swiggy scans | Challenge-heavy | AWS WAF traffic dominated the useful request set | Not applicable | Used for discovery, not extraction |
| Playwright network interception | Browser-only | Could capture listing JSON after page load | `Show More` request is session-dependent | Removed from final actor |

## Failure Diagnosis Notes

- The old actor depended on Playwright Firefox and `got-scraping` for browser-like HTTP requests.
- A previous keyword run returned zero records because Swiggy shifted the default search response to the dish tab. Explicitly selecting `RESTAURANT` fixes the primary path; `DISH` remains enrichment.
- Direct tests with one shared Impit instance successfully fetched the listing, restaurant search, dish search, and Nominatim endpoints without manually overriding browser fingerprint headers.
- Direct HTTP calls to `restaurants/list/update` returned HTTP 403 even after replaying session cookies and response tokens from the working first-page response.
- Supplying offset and widget-offset values to `restaurants/list/v5` returned another first-page-style payload in testing, so offset continuation is not treated as reliable.

## Request Pattern Audit

| Concern | Verified working flow | Actor behavior | Finding |
| --- | --- | --- | --- |
| Browser profile and User-Agent | Desktop Swiggy requests succeeded with the Impit Chrome profile | `browser: 'chrome'`; no manual `User-Agent`, `Accept`, `sec-*`, or language headers | Consistent; do not switch to mobile or app emulation |
| Origin and Referer | Swiggy JSON calls accept the page origin and city/search page referrer | Adds `Origin: https://www.swiggy.com` and the relevant city URL only for Swiggy requests | Consistent; Nominatim receives no Swiggy headers |
| Cookies and sessions | Listing/search endpoints returned data without replayed cookies or auth | No cookies or tokens are fabricated or required | No session inconsistency observed; browser-gated continuation was rejected |
| Query parameters | `list/v5` and `search/v3` succeeded with the documented desktop query shape | Keeps `page_type=DESKTOP_WEB_LISTING`, `trackingId=undefined`, `submitAction=ENTER`, and explicit search tabs | Consistent; no unverified offset replay |
| Request order | Location must be resolved before coordinate-bound listing/search calls; restaurant search should precede dish enrichment | Geocodes first, searches the center then distinct bounded-box areas sequentially, then requests `DISH` only when more restaurants are needed | Consistent and avoids an unnecessary enrichment request |
| Concurrency and pacing | No evidence that direct HTTP needs throttling; browser flow was sequential | Coordinate requests are sequential; successful requests have no artificial delay | Preserves coverage without adding rate-limit pressure or arbitrary slowdown |
| Temporary failures | 403/408/425/429/5xx and transport/parse failures can be transient | Three bounded attempts, 30-second request timeout, capped backoff, and `Retry-After` support for rate limits | Recovery is bounded; permanent 4xx responses are not retried |
| Endpoint selection | `list/update` returned 403; `list/v5` and `search/v3` returned usable JSON | Uses only the verified direct endpoints | No endpoint mismatch found |
| Mobile/app variants | No mobile/app endpoint was verified as richer or more reliable | Uses supported Impit desktop Chrome emulation | Mobile/app variants are intentionally not used |

### Blocking and failure assessment

- No current selected-flow inconsistency was observed to cause blocking: listing, restaurant search, dish search, and Nominatim all returned HTTP 200 in direct Impit tests.
- The known empty-result failure was caused by Swiggy returning the dish tab when the search tab was implicit. The actor now explicitly requests `selectedPLTab=RESTAURANT`.
- The known HTTP 403 was specific to `restaurants/list/update`, which required browser session state. That endpoint and its browser fallback are no longer used.
- The actor does not create concurrent bursts or add a fixed delay between successful requests. `maxPages` still controls coordinate coverage, and `resultsWanted` still caps output.

## Final Implementation Decision

- The actor is fully HTTP-only and uses one shared `Impit` instance for connection reuse, Chrome TLS/browser fingerprinting, bounded retries, and optional proxy routing.
- Playwright, Firefox-specific headers, manual browser fingerprint headers, browser request interception, and browser pagination are removed.
- City collection preserves `maxPages` as the coordinate expansion limit and deduplicates records by restaurant ID.
- Keyword collection uses the same bounded coordinate expansion to overcome the single-response search cap while preserving keyword filtering; it stops at `resultsWanted` and deduplicates by restaurant ID.
- `resultsWanted`, keyword search, city listing, input aliases, output field names, and proxy configuration remain supported.
- Explicit user input has priority: a supplied keyword selects keyword search, a supplied URL selects city listing when no keyword is supplied, and a supplied location is used instead of the Bangalore fallback.
- Keyword-only input uses Bangalore only as the location fallback because Swiggy search requires coordinates; this fallback is applied only when both URL and location are absent.
- The lightweight `apify/actor-node:24` image is used because no browser runtime is required. Docker retains optional npm dependencies so Impit's platform binary is installed.
