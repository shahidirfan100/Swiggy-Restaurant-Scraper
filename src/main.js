import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';
import { firefox } from 'playwright';

const SWIGGY_BASE_URL = 'https://www.swiggy.com';
const SWIGGY_LISTING_ENDPOINT = `${SWIGGY_BASE_URL}/dapi/restaurants/list/v5`;
const SWIGGY_SEARCH_ENDPOINT = `${SWIGGY_BASE_URL}/dapi/restaurants/search/v3`;
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 3;
const FIREFOX_USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
];
const BROWSER_HEADER_PROFILES = [
    {
        'User-Agent': FIREFOX_USER_AGENTS[0],
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    },
    {
        'User-Agent': FIREFOX_USER_AGENTS[1],
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    },
    {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Chromium";v="145", "Google Chrome";v="145", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
    },
];
const GEOCODER_USER_AGENT = 'swiggy-restaurant-scraper/1.0 (apify actor)';
const TRACKER_PATTERNS = ['google-analytics', 'googletagmanager', 'doubleclick', 'adsense', 'facebook'];

await Actor.main(async () => {
    try {
        const input = await getRuntimeInput();
        const normalizedInput = normalizeInput(input);

        if (!normalizedInput.url && !normalizedInput.location) {
            throw new Error('Provide either "url" or "location".');
        }

        const proxyConfiguration = normalizedInput.proxyConfiguration
            ? await Actor.createProxyConfiguration(normalizedInput.proxyConfiguration)
            : undefined;
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

        const resolvedLocation = await resolveLocation({
            url: normalizedInput.url,
            location: normalizedInput.location,
            proxyUrl,
        });

        const refererUrl = normalizedInput.url || buildCityUrl(resolvedLocation.citySlug);

        let records;
        if (normalizedInput.keyword) {
            records = await fetchKeywordResults({
                keyword: normalizedInput.keyword,
                maxPages: normalizedInput.maxPages,
                resultsWanted: normalizedInput.resultsWanted,
                proxyUrl,
                refererUrl,
                resolvedLocation,
            });
        } else {
            records = await fetchCityResults({
                maxPages: normalizedInput.maxPages,
                pageUrl: normalizedInput.url,
                proxyUrl,
                refererUrl,
                resolvedLocation,
                resultsWanted: normalizedInput.resultsWanted,
            });
        }

        if (!records.length) {
            throw new Error('The actor finished without collecting any restaurants.');
        }

        if (records.length < normalizedInput.resultsWanted) {
            log.warning(`Only ${records.length} restaurants were available for this query context (requested ${normalizedInput.resultsWanted}).`);
        }

        await Actor.pushData(records);
        log.info(`Saved ${records.length} restaurants.`);
    } catch (error) {
        log.exception(error, 'Actor failed');
        throw error;
    }
});

async function getRuntimeInput() {
    const runtimeInput = await Actor.getInput();
    if (hasUserProvidedInput(runtimeInput)) {
        return runtimeInput;
    }

    try {
        const localInput = JSON.parse(await readFile(new URL('../INPUT.json', import.meta.url), 'utf8'));
        log.info('Using local INPUT.json fallback because no runtime input was provided.');
        return localInput;
    } catch {
        return {};
    }
}

function hasUserProvidedInput(input) {
    const normalizedInput = normalizeInput(input || {});
    return Boolean(normalizedInput.url || normalizedInput.location || normalizedInput.keyword);
}

function normalizeInput(input) {
    const normalizedInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

    return {
        url: asNonEmptyString(
            pickFirstValue(normalizedInput, ['url', 'startUrl', 'start_url', 'startURL'])
            || extractStartUrlsValue(pickFirstValue(normalizedInput, ['startUrls', 'start_urls'])),
        ),
        keyword: asNonEmptyString(pickFirstValue(normalizedInput, ['keyword', 'query', 'search', 'searchTerm', 'term'])),
        location: asNonEmptyString(pickFirstValue(normalizedInput, ['location', 'city', 'cityName', 'city_name', 'place'])),
        resultsWanted: toPositiveInteger(pickFirstValue(normalizedInput, ['resultsWanted', 'results_wanted']), DEFAULT_RESULTS_WANTED),
        maxPages: toPositiveInteger(pickFirstValue(normalizedInput, ['maxPages', 'max_pages']), DEFAULT_MAX_PAGES),
        proxyConfiguration: pickFirstValue(normalizedInput, ['proxyConfiguration', 'proxy_configuration']),
    };
}

function pickFirstValue(input, keys) {
    for (const key of keys) {
        const value = getInputValue(input, key);
        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return undefined;
}

function getInputValue(input, key) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return undefined;
    }

    if (Object.hasOwn(input, key)) {
        return input[key];
    }

    const expectedKey = key.toLowerCase();
    for (const inputKey of Object.keys(input)) {
        if (inputKey.toLowerCase() === expectedKey) {
            return input[inputKey];
        }
    }

    return undefined;
}

function extractStartUrlsValue(startUrlsValue) {
    if (!Array.isArray(startUrlsValue) || !startUrlsValue.length) {
        return undefined;
    }

    const [firstEntry] = startUrlsValue;
    if (typeof firstEntry === 'string') {
        return firstEntry;
    }

    if (firstEntry && typeof firstEntry === 'object') {
        return firstEntry.url || firstEntry.URL;
    }

    return undefined;
}

function asNonEmptyString(value) {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function toPositiveInteger(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1) return fallback;
    return Math.floor(numericValue);
}

async function resolveLocation({ url, location, proxyUrl }) {
    const parsedUrl = url ? parseSwiggyUrl(url) : undefined;
    const query = parsedUrl?.cityName || location;

    if (!query) {
        throw new Error('Could not determine the city from the provided input.');
    }

    const resolvedByGeocoder = await geocodeLocation({
        query,
        proxyUrl,
        preferCityLookup: Boolean(parsedUrl?.cityName && !location),
    });
    if (resolvedByGeocoder) {
        return {
            cityName: parsedUrl?.cityName || resolvedByGeocoder.cityName,
            citySlug: parsedUrl?.citySlug || slugifyCityName(parsedUrl?.cityName || resolvedByGeocoder.cityName),
            lat: resolvedByGeocoder.lat,
            lng: resolvedByGeocoder.lng,
            boundingBox: resolvedByGeocoder.boundingBox,
        };
    }

    if (url) {
        const browserLocation = await resolveLocationFromBrowser(url, proxyUrl);
        if (browserLocation) {
            return browserLocation;
        }
    }

    throw new Error(`Could not resolve coordinates for "${query}".`);
}

function parseSwiggyUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('The provided url is not a valid URL.');
    }

    if (!/swiggy\.com$/i.test(parsed.hostname)) {
        throw new Error('The provided url must point to swiggy.com.');
    }

    const cityMatch = parsed.pathname.match(/\/city\/([^/?#]+)/i);
    if (!cityMatch) {
        throw new Error('The provided url must be a Swiggy city or city collection URL.');
    }

    const citySlug = cityMatch[1].trim().toLowerCase();
    return {
        citySlug,
        cityName: unslugifyCityName(citySlug),
    };
}

async function geocodeLocation({ query, proxyUrl, preferCityLookup }) {
    const requestGeocode = async (params) => {
        const geocodingUrl = new URL(NOMINATIM_ENDPOINT);
        geocodingUrl.searchParams.set('format', 'jsonv2');
        geocodingUrl.searchParams.set('limit', '1');

        for (const [key, value] of Object.entries(params)) {
            geocodingUrl.searchParams.set(key, value);
        }

        const response = await gotScraping({
            url: geocodingUrl.toString(),
            method: 'GET',
            proxyUrl,
            retry: { limit: 2 },
            timeout: { request: 30000 },
            responseType: 'json',
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': GEOCODER_USER_AGENT,
            },
        });

        return Array.isArray(response.body) ? response.body[0] : undefined;
    };

    try {
        let firstResult;

        if (preferCityLookup) {
            firstResult = await requestGeocode({
                city: query,
                country: 'India',
                addressdetails: '1',
            });
        }

        if (!firstResult?.lat || !firstResult?.lon) {
            firstResult = await requestGeocode({
                q: `${query}, India`,
                addressdetails: '1',
            });
        }

        if (!firstResult?.lat || !firstResult?.lon) return undefined;

        return {
            cityName: firstResult.address?.city || firstResult.address?.town || firstResult.address?.county || firstResult.name || query,
            lat: Number(firstResult.lat),
            lng: Number(firstResult.lon),
            boundingBox: parseBoundingBox(firstResult.boundingbox),
        };
    } catch (error) {
        log.warning(`Geocoding failed for ${query}: ${error.message}`);
        return undefined;
    }
}

function parseBoundingBox(rawBoundingBox) {
    if (!Array.isArray(rawBoundingBox) || rawBoundingBox.length !== 4) {
        return undefined;
    }

    const [south, north, west, east] = rawBoundingBox.map((value) => Number(value));
    if (![south, north, west, east].every((value) => Number.isFinite(value))) {
        return undefined;
    }

    return { south, north, west, east };
}

async function resolveLocationFromBrowser(pageUrl, proxyUrl) {
    let browser;

    try {
        browser = await firefox.launch({
            headless: true,
            proxy: toPlaywrightProxy(proxyUrl),
        });

        const context = await browser.newContext({
            locale: 'en-US',
            userAgent: randomUserAgent(),
            viewport: { width: 1440, height: 960 },
        });
        const page = await context.newPage();
        await installRequestBlocker(page);

        const listingResponsePromise = page.waitForResponse((response) => {
            return response.url().includes('/dapi/restaurants/list/v5') && response.status() === 200;
        }, { timeout: 45000 });

        await page.goto(pageUrl, { timeout: 45000, waitUntil: 'domcontentloaded' });
        const listingResponse = await listingResponsePromise;
        const listingPayload = await listingResponse.json();
        const metaContext = extractMetaContext(listingPayload);

        if (!metaContext?.lat || !metaContext?.lng || !metaContext?.citySlug) {
            return undefined;
        }

        return {
            cityName: metaContext.pageContext?.cityName || unslugifyCityName(metaContext.citySlug),
            citySlug: metaContext.citySlug,
            lat: Number(metaContext.lat),
            lng: Number(metaContext.lng),
        };
    } catch (error) {
        log.warning(`Browser-assisted location resolution failed: ${error.message}`);
        return undefined;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function fetchKeywordResults({ keyword, maxPages, resultsWanted, proxyUrl, refererUrl, resolvedLocation }) {
    const restaurantMap = new Map();

    const restaurantPayload = await fetchJson(
        buildSearchUrl({ keyword, resolvedLocation, selectedTab: 'RESTAURANT' }),
        proxyUrl,
        refererUrl,
    );
    const restaurantCards = collectSearchRestaurantCards(restaurantPayload);
    if (!restaurantCards.length) {
        log.warning(`No restaurant cards found in keyword response. Response shape: ${describePayloadShape(restaurantPayload)}`);
    }

    for (const restaurantCard of restaurantCards) {
        const restaurantInfo = restaurantCard?.card?.card?.info;
        if (!restaurantInfo?.id || restaurantMap.has(restaurantInfo.id)) continue;

        restaurantMap.set(restaurantInfo.id, mapRestaurantRecord({
            cityName: resolvedLocation.cityName,
            citySlug: restaurantInfo.slugs?.city || resolvedLocation.citySlug,
            contextLabel: 'keyword_search',
            restaurantCard: restaurantCard.card.card,
        }));

        if (restaurantMap.size >= resultsWanted) break;
    }

    let dishPayload;
    try {
        dishPayload = await fetchJson(
            buildSearchUrl({ keyword, resolvedLocation, selectedTab: 'DISH' }),
            proxyUrl,
            refererUrl,
        );
    } catch (error) {
        log.warning(`Dish enrichment request failed; continuing with restaurant matches only: ${error.message}`);
    }

    const dishCards = collectSearchDishCards(dishPayload);
    if (dishPayload && !dishCards.length) {
        log.info(`No dish cards found in keyword enrichment response. Response shape: ${describePayloadShape(dishPayload)}`);
    }

    for (const dishCard of dishCards) {
        const restaurantInfo = dishCard?.card?.card?.restaurant?.info;
        if (!restaurantInfo?.id) continue;

        const mappedRestaurant = restaurantMap.get(restaurantInfo.id)
            || mapRestaurantRecord({
                cityName: resolvedLocation.cityName,
                citySlug: restaurantInfo.slugs?.city || resolvedLocation.citySlug,
                contextLabel: 'keyword_search',
                restaurantCard: dishCard.card.card.restaurant,
            });

        const dishInfo = dishCard.card?.card?.info;
        if (dishInfo) {
            mappedRestaurant.matchedDishes = mappedRestaurant.matchedDishes || [];
            if (mappedRestaurant.matchedDishes.length < 5) {
                mappedRestaurant.matchedDishes.push(sanitizeRecord({
                    name: dishInfo.name,
                    category: dishInfo.category,
                    description: dishInfo.description,
                    imageId: dishInfo.imageId,
                    imageUrl: toImageUrl(dishInfo.imageId),
                    inStock: dishInfo.inStock === 1,
                    isVeg: dishInfo.isVeg === 1,
                    price: toCurrencyString(dishInfo.price),
                    finalPrice: toCurrencyString(dishInfo.finalPrice),
                    rating: dishInfo.ratings?.aggregatedRating?.rating,
                    ratingCount: dishInfo.ratings?.aggregatedRating?.ratingCountV2 || dishInfo.ratings?.aggregatedRating?.ratingCount,
                }));
            }
        }

        restaurantMap.set(restaurantInfo.id, sanitizeRecord(mappedRestaurant));
        if (restaurantMap.size >= resultsWanted) break;
    }

    if (!restaurantMap.size) {
        log.warning('Keyword search produced no restaurant records; falling back to city listing results for the resolved location.');
        return fetchCityResults({
            maxPages,
            pageUrl: undefined,
            proxyUrl,
            refererUrl,
            resolvedLocation,
            resultsWanted,
        });
    }

    return [...restaurantMap.values()].slice(0, resultsWanted);
}

function buildSearchUrl({ keyword, resolvedLocation, selectedTab }) {
    const endpointUrl = new URL(SWIGGY_SEARCH_ENDPOINT);
    endpointUrl.searchParams.set('lat', String(resolvedLocation.lat));
    endpointUrl.searchParams.set('lng', String(resolvedLocation.lng));
    endpointUrl.searchParams.set('str', keyword);
    endpointUrl.searchParams.set('trackingId', 'undefined');
    endpointUrl.searchParams.set('submitAction', 'ENTER');
    endpointUrl.searchParams.set('selectedPLTab', selectedTab);
    return endpointUrl.toString();
}

async function fetchCityResults({ maxPages, pageUrl, proxyUrl, refererUrl, resolvedLocation, resultsWanted }) {
    const collectedRecords = [];
    const seenRestaurantIds = new Set();

    const coordinateTargets = buildCoordinateTargets(resolvedLocation, maxPages);
    for (const coordinateTarget of coordinateTargets) {
        const listingPayload = await fetchJson(
            buildListingUrl(coordinateTarget.lat, coordinateTarget.lng),
            proxyUrl,
            refererUrl,
        );

        addRestaurantBatch({
            collectedRecords,
            contextLabel: 'city_listing',
            restaurantCards: collectListingCards(listingPayload),
            seenRestaurantIds,
            cityName: resolvedLocation.cityName,
            citySlug: resolvedLocation.citySlug,
        });

        if (collectedRecords.length >= resultsWanted) {
            return collectedRecords.slice(0, resultsWanted);
        }

        const pageOffset = extractPageOffset(listingPayload);
        if (!pageOffset?.nextOffset) {
            continue;
        }

        const offsetListingPayload = await fetchJson(
            buildListingUrl(coordinateTarget.lat, coordinateTarget.lng, {
                offset: pageOffset.nextOffset,
                widgetOffset: pageOffset.widgetOffset,
            }),
            proxyUrl,
            refererUrl,
        );

        addRestaurantBatch({
            collectedRecords,
            contextLabel: 'city_listing',
            restaurantCards: collectListingCards(offsetListingPayload),
            seenRestaurantIds,
            cityName: resolvedLocation.cityName,
            citySlug: resolvedLocation.citySlug,
        });

        if (collectedRecords.length >= resultsWanted) {
            return collectedRecords.slice(0, resultsWanted);
        }
    }

    const shouldUseBrowserPagination = Boolean(
        pageUrl
        && collectedRecords.length < resultsWanted
        && process.env.SWIGGY_ENABLE_BROWSER_PAGINATION === '1',
    );

    if (!shouldUseBrowserPagination) {
        return collectedRecords.slice(0, resultsWanted);
    }

    const browserRecords = await fetchCityResultsInBrowser({
        maxPages,
        pageUrl,
        proxyUrl,
        resultsWanted,
        seenRestaurantIds,
    });

    for (const record of browserRecords) {
        if (seenRestaurantIds.has(record.restaurantId)) continue;
        seenRestaurantIds.add(record.restaurantId);
        collectedRecords.push(record);
        if (collectedRecords.length >= resultsWanted) break;
    }

    return collectedRecords.slice(0, resultsWanted);
}

async function fetchCityResultsInBrowser({ maxPages, pageUrl, proxyUrl, resultsWanted, seenRestaurantIds }) {
    let browser;

    try {
        browser = await firefox.launch({
            headless: true,
            proxy: toPlaywrightProxy(proxyUrl),
        });

        const context = await browser.newContext({
            locale: 'en-US',
            userAgent: randomUserAgent(),
            viewport: { width: 1440, height: 960 },
        });
        const page = await context.newPage();
        await installRequestBlocker(page);

        const responseQueue = [];
        page.on('response', async (response) => {
            const contentType = response.headers()['content-type'] || '';
            if (!response.url().includes('/dapi/restaurants/list/') || !contentType.includes('application/json')) return;

            try {
                responseQueue.push({
                    json: await response.json(),
                    url: response.url(),
                });
            } catch {
                log.warning(`Could not parse JSON from ${response.url()}`);
            }
        });

        await page.goto(pageUrl, { timeout: 45000, waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

        const collectedRecords = [];
        const browserSeenRestaurantIds = new Set(seenRestaurantIds);

        consumeQueuedListingResponses({
            collectedRecords,
            contextLabel: 'city_listing',
            responseQueue,
            seenRestaurantIds: browserSeenRestaurantIds,
        });

        for (let pageIndex = 2; pageIndex <= maxPages && seenRestaurantIds.size + collectedRecords.length < resultsWanted; pageIndex++) {
            const showMoreButton = page.getByText('Show More', { exact: true });
            const isVisible = await showMoreButton.isVisible().catch(() => false);
            if (!isVisible) break;

            const updateResponsePromise = page.waitForResponse((response) => {
                return response.url().includes('/dapi/restaurants/list/') && response.status() === 200;
            }, { timeout: 20000 }).catch(() => null);

            await showMoreButton.scrollIntoViewIfNeeded().catch(() => {});
            await showMoreButton.click({ timeout: 5000 });
            await updateResponsePromise;
            await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

            consumeQueuedListingResponses({
                collectedRecords,
                contextLabel: 'city_listing',
                responseQueue,
                seenRestaurantIds: browserSeenRestaurantIds,
            });
        }

        return collectedRecords.slice(0, resultsWanted);
    } catch (error) {
        log.warning(`Browser-assisted pagination failed: ${error.message}`);
        return [];
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

function consumeQueuedListingResponses({
    collectedRecords,
    contextLabel,
    responseQueue,
    seenRestaurantIds,
}) {
    while (responseQueue.length) {
        const responseEntry = responseQueue.shift();

        const metaContext = extractMetaContext(responseEntry.json);
        const cityName = metaContext?.pageContext?.cityName || unslugifyCityName(metaContext?.citySlug || '');
        const citySlug = metaContext?.citySlug || slugifyCityName(cityName);

        addRestaurantBatch({
            collectedRecords,
            contextLabel,
            restaurantCards: collectListingCards(responseEntry.json),
            seenRestaurantIds,
            cityName,
            citySlug,
        });
    }
}

function addRestaurantBatch({ collectedRecords, contextLabel, restaurantCards, seenRestaurantIds, cityName, citySlug }) {
    for (const restaurantCard of restaurantCards) {
        const mappedRecord = mapRestaurantRecord({ cityName, citySlug, contextLabel, restaurantCard });
        if (!mappedRecord.restaurantId || seenRestaurantIds.has(mappedRecord.restaurantId)) continue;

        seenRestaurantIds.add(mappedRecord.restaurantId);
        collectedRecords.push(mappedRecord);
    }
}

async function fetchJson(url, proxyUrl, refererUrl) {
    let lastError;

    for (const headerProfile of BROWSER_HEADER_PROFILES) {
        try {
            const response = await gotScraping({
                url,
                method: 'GET',
                proxyUrl,
                retry: { limit: 1 },
                timeout: { request: 30000 },
                responseType: 'json',
                headers: {
                    Accept: 'application/json, text/plain, */*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    Origin: SWIGGY_BASE_URL,
                    Referer: refererUrl,
                    ...headerProfile,
                },
            });

            return response.body;
        } catch (error) {
            lastError = error;
            const statusCode = error.response?.statusCode;
            log.warning(`Request failed for ${new URL(url).pathname}${statusCode ? ` with HTTP ${statusCode}` : ''}: ${error.message}`);
        }
    }

    throw lastError;
}

function extractPageOffset(payload) {
    return payload?.data?.pageOffset;
}

function buildCoordinateTargets(resolvedLocation, maxPages) {
    const targets = [{ lat: resolvedLocation.lat, lng: resolvedLocation.lng }];
    const { boundingBox } = resolvedLocation;

    if (!boundingBox || maxPages <= 1) {
        return targets;
    }

    const centerLat = (boundingBox.south + boundingBox.north) / 2;
    const centerLng = (boundingBox.west + boundingBox.east) / 2;
    const candidateTargets = [
        { lat: centerLat, lng: centerLng },
        { lat: boundingBox.south, lng: boundingBox.west },
        { lat: boundingBox.south, lng: boundingBox.east },
        { lat: boundingBox.north, lng: boundingBox.west },
        { lat: boundingBox.north, lng: boundingBox.east },
        { lat: boundingBox.south, lng: centerLng },
        { lat: boundingBox.north, lng: centerLng },
        { lat: centerLat, lng: boundingBox.west },
        { lat: centerLat, lng: boundingBox.east },
    ];

    const seenTargets = new Set([toCoordinateKey(resolvedLocation.lat, resolvedLocation.lng)]);
    for (const candidateTarget of candidateTargets) {
        const coordinateKey = toCoordinateKey(candidateTarget.lat, candidateTarget.lng);
        if (seenTargets.has(coordinateKey)) continue;

        seenTargets.add(coordinateKey);
        targets.push(candidateTarget);
        if (targets.length >= maxPages) break;
    }

    return targets;
}

function toCoordinateKey(lat, lng) {
    return `${Number(lat).toFixed(4)}:${Number(lng).toFixed(4)}`;
}

function buildListingUrl(lat, lng, options = {}) {
    const listingUrl = new URL(SWIGGY_LISTING_ENDPOINT);
    listingUrl.searchParams.set('lat', String(lat));
    listingUrl.searchParams.set('lng', String(lng));
    listingUrl.searchParams.set('is-seo-homepage-enabled', 'true');
    listingUrl.searchParams.set('page_type', 'DESKTOP_WEB_LISTING');

    if (options.offset) {
        listingUrl.searchParams.set('offset', options.offset);
    }

    if (options.widgetOffset && typeof options.widgetOffset === 'object') {
        listingUrl.searchParams.set('widget_offset', JSON.stringify(options.widgetOffset));
    }

    return listingUrl.toString();
}

function buildCityUrl(citySlug) {
    return `${SWIGGY_BASE_URL}/city/${citySlug}`;
}

function collectListingCards(payload) {
    const mainGridCards = payload?.data?.cards
        ?.filter((card) => card?.card?.card?.id === 'restaurant_grid_listing_v2')
        .flatMap((card) => card.card.card.gridElements?.infoWithStyle?.restaurants || []);

    if (mainGridCards?.length) {
        return mainGridCards;
    }

    const recursiveCards = [];
    visitValue(payload, (value) => {
        if (Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object')) {
            const restaurantEntries = value.filter((entry) => entry?.info?.id && entry?.info?.name);
            if (restaurantEntries.length) {
                recursiveCards.push(...restaurantEntries);
            }
        }
    });

    return recursiveCards;
}

function collectSearchDishCards(payload) {
    const dishCards = [];
    visitValue(payload?.data?.cards, (value) => {
        if (!Array.isArray(value)) return;

        for (const entry of value) {
            const dishInfo = entry?.card?.card?.info;
            const restaurantInfo = entry?.card?.card?.restaurant?.info;
            if (dishInfo && restaurantInfo?.id) {
                dishCards.push(entry);
            }
        }
    });
    return dishCards;
}

function collectSearchRestaurantCards(payload) {
    const restaurantCards = [];
    visitValue(payload?.data?.cards, (value) => {
        if (!Array.isArray(value)) return;

        for (const entry of value) {
            const card = entry?.card?.card;
            if (card?.info?.id && card?.info?.name && !card?.restaurant) {
                restaurantCards.push(entry);
            }
        }
    });
    return restaurantCards;
}

function visitValue(value, visitor) {
    visitor(value);

    if (Array.isArray(value)) {
        for (const entry of value) {
            visitValue(entry, visitor);
        }
        return;
    }

    if (!value || typeof value !== 'object') return;
    for (const nestedValue of Object.values(value)) {
        visitValue(nestedValue, visitor);
    }
}

function describePayloadShape(payload) {
    const dataKeys = Object.keys(payload?.data || {});
    const topLevelCardCount = payload?.data?.cards?.length || 0;
    const groupKeys = new Set();

    visitValue(payload?.data?.cards, (value) => {
        if (value?.cardGroupMap && typeof value.cardGroupMap === 'object') {
            for (const key of Object.keys(value.cardGroupMap)) {
                groupKeys.add(key);
            }
        }
    });

    return JSON.stringify({
        topLevelKeys: Object.keys(payload || {}),
        dataKeys,
        topLevelCardCount,
        groupKeys: [...groupKeys],
    });
}

function extractMetaContext(payload) {
    let metaContext;
    visitValue(payload?.data?.cards, (value) => {
        if (metaContext || !value || typeof value !== 'object') return;
        if (value['@type'] === 'type.googleapis.com/swiggy.seo.widgets.v1.MetaContext') {
            metaContext = value;
        }
    });
    return metaContext;
}

function mapRestaurantRecord({ cityName, citySlug, contextLabel, restaurantCard }) {
    const info = restaurantCard?.info || {};
    const cta = restaurantCard?.cta || {};
    const slugs = info.slugs || {};

    return sanitizeRecord({
        sourceType: contextLabel,
        restaurantId: String(info.id || ''),
        name: info.name,
        city: cityName,
        citySlug: slugs.city || citySlug,
        locality: info.locality,
        areaName: info.areaName,
        address: info.address,
        cuisines: Array.isArray(info.cuisines) ? info.cuisines : undefined,
        costForTwo: info.costForTwoMessage || info.costForTwo,
        avgRating: info.avgRating ?? info.avgRatingString,
        avgRatingString: info.avgRatingString,
        totalRatingsString: info.totalRatingsString,
        deliveryTime: info.sla?.deliveryTime,
        minDeliveryTime: info.sla?.minDeliveryTime,
        maxDeliveryTime: info.sla?.maxDeliveryTime,
        lastMileTravelKm: info.sla?.lastMileTravel,
        slaString: info.sla?.slaString,
        isOpen: info.isOpen ?? info.availability?.opened,
        nextCloseTime: info.availability?.nextCloseTime,
        parentId: info.parentId,
        cloudinaryImageId: info.cloudinaryImageId,
        imageUrl: toImageUrl(info.cloudinaryImageId),
        discountSummary: info.aggregatedDiscountInfoV3?.header
            ? `${info.aggregatedDiscountInfoV3.header}${info.aggregatedDiscountInfoV3.subHeader ? ` ${info.aggregatedDiscountInfoV3.subHeader}` : ''}`
            : undefined,
        badges: collectBadgeDescriptions(info),
        externalRating: info.externalRatings?.aggregatedRating?.rating,
        externalRatingCount: info.externalRatings?.aggregatedRating?.ratingCount,
        url: toAbsoluteUrl(cta.link) || buildRestaurantUrl(slugs, info.id),
    });
}

function collectBadgeDescriptions(info) {
    const badgeDescriptions = [];

    for (const badge of info.badges?.imageBadges || []) {
        if (badge?.description) badgeDescriptions.push(badge.description);
    }

    for (const badge of info.badgesV2?.entityBadges?.imageBased?.badgeObject || []) {
        if (badge?.attributes?.description) badgeDescriptions.push(badge.attributes.description);
    }

    return badgeDescriptions.length ? badgeDescriptions : undefined;
}

function toAbsoluteUrl(value) {
    if (!value || typeof value !== 'string') return undefined;

    try {
        return new URL(value, SWIGGY_BASE_URL).href;
    } catch {
        return undefined;
    }
}

function buildRestaurantUrl(slugs, restaurantId) {
    if (!slugs?.restaurant || !restaurantId || !slugs?.city) return undefined;
    return `${SWIGGY_BASE_URL}/city/${slugs.city}/${slugs.restaurant}-rest${restaurantId}`;
}

function toImageUrl(imageId) {
    if (!imageId || typeof imageId !== 'string') return undefined;

    const trimmedImageId = imageId.trim();
    if (!trimmedImageId) return undefined;

    if (/^https?:\/\//i.test(trimmedImageId)) {
        return trimmedImageId;
    }

    if (trimmedImageId.startsWith('//')) {
        return `https:${trimmedImageId}`;
    }

    return `https://media-assets.swiggy.com/swiggy/image/upload/${trimmedImageId.replace(/^\/+/, '')}`;
}

function toCurrencyString(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return undefined;
    return `INR ${(Number(value) / 100).toFixed(2)}`;
}

function sanitizeRecord(value) {
    if (Array.isArray(value)) {
        const filteredItems = value
            .map((entry) => sanitizeRecord(entry))
            .filter((entry) => entry !== undefined);
        return filteredItems.length ? filteredItems : undefined;
    }

    if (!value || typeof value !== 'object') {
        if (value === null || value === undefined || value === '') return undefined;
        return value;
    }

    const sanitizedEntries = Object.entries(value)
        .map(([key, nestedValue]) => [key, sanitizeRecord(nestedValue)])
        .filter(([, nestedValue]) => nestedValue !== undefined);

    return sanitizedEntries.length ? Object.fromEntries(sanitizedEntries) : undefined;
}

async function installRequestBlocker(page) {
    await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        const requestUrl = route.request().url();

        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)
            || TRACKER_PATTERNS.some((pattern) => requestUrl.includes(pattern))) {
            return route.abort();
        }

        return route.continue();
    });
}

function toPlaywrightProxy(proxyUrl) {
    if (!proxyUrl) return undefined;

    const parsedUrl = new URL(proxyUrl);
    return {
        server: `${parsedUrl.protocol}//${parsedUrl.host}`,
        username: decodeURIComponent(parsedUrl.username),
        password: decodeURIComponent(parsedUrl.password),
    };
}

function randomUserAgent() {
    return FIREFOX_USER_AGENTS[Math.floor(Math.random() * FIREFOX_USER_AGENTS.length)];
}

function unslugifyCityName(citySlug) {
    return citySlug
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');
}

function slugifyCityName(cityName) {
    return cityName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
