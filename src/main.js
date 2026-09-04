import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const SWIGGY_BASE_URL = 'https://www.swiggy.com';
const SWIGGY_LISTING_ENDPOINT = `${SWIGGY_BASE_URL}/dapi/restaurants/list/v5`;
const SWIGGY_SEARCH_ENDPOINT = `${SWIGGY_BASE_URL}/dapi/restaurants/search/v3`;
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_RESULTS_WANTED = 20;
const DEFAULT_MAX_PAGES = 3;
const KEYWORD_ONLY_LOCATION = 'Bangalore';
const MAX_REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRY_DELAY_MS = 10000;

await Actor.main(async () => {
    try {
        const input = await getRuntimeInput();
        const normalizedInput = normalizeInput(input);

        if (normalizedInput.keyword && !normalizedInput.url && !normalizedInput.location) {
            normalizedInput.location = await getKeywordLocationFallback();
        }

        if (!normalizedInput.url && !normalizedInput.location) {
            throw new Error('Provide either "url" or "location".');
        }

        const proxyConfiguration = normalizedInput.proxyConfiguration
            ? await Actor.createProxyConfiguration(normalizedInput.proxyConfiguration)
            : undefined;
        const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;

        // One shared impit client handles TLS + header fingerprinting and
        // connection pooling across all requests.
        const client = new Impit({
            browser: 'chrome',
            ignoreTlsErrors: true,
            ...(proxyUrl && { proxyUrl }),
        });

        const resolvedLocation = await resolveLocation({
            url: normalizedInput.url,
            location: normalizedInput.location,
            client,
        });

        const refererUrl = normalizedInput.url || buildCityUrl(resolvedLocation.citySlug);

        let records;
        if (normalizedInput.keyword) {
            records = await fetchKeywordResults({
                keyword: normalizedInput.keyword,
                maxPages: normalizedInput.maxPages,
                resultsWanted: normalizedInput.resultsWanted,
                client,
                refererUrl,
                resolvedLocation,
            });
        } else {
            records = await fetchCityResults({
                maxPages: normalizedInput.maxPages,
                client,
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
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false;

    return Object.values(input).some((value) => {
        if (typeof value === 'string') return Boolean(value.trim());
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return value !== undefined && value !== null;
    });
}

function normalizeInput(input) {
    const normalizedInput = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const url = normalizeUrlValue(
        pickFirstValue(normalizedInput, ['url', 'startUrl', 'start_url', 'startURL'])
        || extractStartUrlsValue(pickFirstValue(normalizedInput, ['startUrls', 'start_urls'])),
    );
    const keyword = asNonEmptyString(pickFirstValue(normalizedInput, ['keyword', 'query', 'search', 'searchTerm', 'term']));
    const location = asNonEmptyString(pickFirstValue(normalizedInput, ['location', 'city', 'cityName', 'city_name', 'place']));

    return {
        url,
        keyword,
        location,
        resultsWanted: toPositiveInteger(pickFirstValue(normalizedInput, ['resultsWanted', 'results_wanted']), DEFAULT_RESULTS_WANTED),
        maxPages: toPositiveInteger(pickFirstValue(normalizedInput, ['maxPages', 'max_pages']), DEFAULT_MAX_PAGES),
        proxyConfiguration: pickFirstValue(normalizedInput, ['proxyConfiguration', 'proxy_configuration']),
    };
}

function getKeywordLocationFallback() {
    return KEYWORD_ONLY_LOCATION;
}

function normalizeUrlValue(value) {
    const normalizedValue = asNonEmptyString(value);
    if (!normalizedValue) return undefined;

    return asNonEmptyString(normalizedValue.replace(/^["'(<]+|[>"')]+$/g, ''));
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

async function resolveLocation({ url, location, client }) {
    const parsedUrl = url ? parseSwiggyUrl(url) : undefined;
    const query = parsedUrl?.cityName || location;

    if (!query) {
        throw new Error('Could not determine the city from the provided input.');
    }

    const resolvedByGeocoder = await geocodeLocation({
        query,
        client,
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

    throw new Error(`Could not resolve coordinates for "${query}".`);
}

function parseSwiggyUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error('The provided url is not a valid URL.');
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!['swiggy.com', 'www.swiggy.com'].includes(hostname)) {
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

async function geocodeLocation({ query, client, preferCityLookup }) {
    const requestGeocode = async (params) => {
        const geocodingUrl = new URL(NOMINATIM_ENDPOINT);
        geocodingUrl.searchParams.set('format', 'jsonv2');
        geocodingUrl.searchParams.set('limit', '1');

        for (const [key, value] of Object.entries(params)) {
            geocodingUrl.searchParams.set(key, value);
        }

        const response = await fetchJson(client, geocodingUrl.toString());
        return Array.isArray(response) ? response[0] : undefined;
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

async function fetchKeywordResults({ keyword, maxPages, resultsWanted, client, refererUrl, resolvedLocation }) {
    const restaurantMap = new Map();
    const searchTargets = buildCoordinateTargets(resolvedLocation, maxPages, true);

    for (const coordinateTarget of searchTargets) {
        if (restaurantMap.size >= resultsWanted) break;

        let restaurantPayload;
        try {
            restaurantPayload = await fetchJson(
                client,
                buildSearchUrl({ keyword, resolvedLocation, selectedTab: 'RESTAURANT', coordinateTarget }),
                refererUrl,
            );
        } catch (error) {
            log.warning(`Restaurant search failed for coordinate ${coordinateTarget.lat},${coordinateTarget.lng}; continuing: ${error.message}`);
            continue;
        }

        const restaurantCards = collectSearchRestaurantCards(restaurantPayload);
        if (!restaurantCards.length) {
            log.warning(`No restaurant cards found for keyword coordinate ${coordinateTarget.lat},${coordinateTarget.lng}. Response shape: ${describePayloadShape(restaurantPayload)}`);
        }

        for (const restaurantCard of restaurantCards) {
            try {
                const restaurantInfo = restaurantCard?.card?.card?.info;
                const restaurantId = normalizeRestaurantId(restaurantInfo?.id);
                if (!restaurantId || restaurantMap.has(restaurantId)) continue;

                restaurantMap.set(restaurantId, mapRestaurantRecord({
                    cityName: resolvedLocation.cityName,
                    citySlug: restaurantInfo.slugs?.city || resolvedLocation.citySlug,
                    contextLabel: 'keyword_search',
                    restaurantCard: restaurantCard.card.card,
                }));

                if (restaurantMap.size >= resultsWanted) break;
            } catch (error) {
                log.warning(`Skipping malformed restaurant card: ${error.message}`);
            }
        }
    }

    if (restaurantMap.size < resultsWanted) {
        let dishPayload;
        try {
            dishPayload = await fetchJson(
                client,
                buildSearchUrl({ keyword, resolvedLocation, selectedTab: 'DISH' }),
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
            try {
                const restaurantInfo = dishCard?.card?.card?.restaurant?.info;
                const restaurantId = normalizeRestaurantId(restaurantInfo?.id);
                if (!restaurantId) continue;

                const mappedRestaurant = restaurantMap.get(restaurantId)
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

                restaurantMap.set(restaurantId, sanitizeRecord(mappedRestaurant));
                if (restaurantMap.size >= resultsWanted) break;
            } catch (error) {
                log.warning(`Skipping malformed dish card: ${error.message}`);
            }
        }
    }

    if (!restaurantMap.size) {
        log.warning('Keyword search produced no restaurant records; falling back to city listing results for the resolved location.');
        return fetchCityResults({
            maxPages,
            client,
            refererUrl,
            resolvedLocation,
            resultsWanted,
        });
    }

    return [...restaurantMap.values()].slice(0, resultsWanted);
}

function buildSearchUrl({ keyword, resolvedLocation, selectedTab, coordinateTarget }) {
    const endpointUrl = new URL(SWIGGY_SEARCH_ENDPOINT);
    endpointUrl.searchParams.set('lat', String(coordinateTarget?.lat ?? resolvedLocation.lat));
    endpointUrl.searchParams.set('lng', String(coordinateTarget?.lng ?? resolvedLocation.lng));
    endpointUrl.searchParams.set('str', keyword);
    endpointUrl.searchParams.set('trackingId', 'undefined');
    endpointUrl.searchParams.set('submitAction', 'ENTER');
    endpointUrl.searchParams.set('selectedPLTab', selectedTab);
    return endpointUrl.toString();
}

async function fetchCityResults({ maxPages, client, refererUrl, resolvedLocation, resultsWanted }) {
    const collectedRecords = [];
    const seenRestaurantIds = new Set();

    for (const coordinateTarget of buildCoordinateTargets(resolvedLocation, maxPages)) {
        let listingPayload;
        try {
            listingPayload = await fetchJson(
                client,
                buildListingUrl(coordinateTarget.lat, coordinateTarget.lng),
                refererUrl,
            );
        } catch (error) {
            log.warning(`Listing request failed for coordinate ${coordinateTarget.lat},${coordinateTarget.lng}; skipping it: ${error.message}`);
            continue;
        }

        const listingCards = collectListingCards(listingPayload);
        if (!listingCards.length) {
            log.warning(`No restaurant cards found for coordinate ${coordinateTarget.lat},${coordinateTarget.lng}. Response shape: ${describePayloadShape(listingPayload)}`);
        }

        addRestaurantBatch({
            collectedRecords,
            contextLabel: 'city_listing',
            restaurantCards: listingCards,
            seenRestaurantIds,
            cityName: resolvedLocation.cityName,
            citySlug: resolvedLocation.citySlug,
        });

        if (collectedRecords.length >= resultsWanted) {
            return collectedRecords.slice(0, resultsWanted);
        }
    }

    return collectedRecords.slice(0, resultsWanted);
}

function addRestaurantBatch({ collectedRecords, contextLabel, restaurantCards, seenRestaurantIds, cityName, citySlug }) {
    for (const restaurantCard of restaurantCards) {
        try {
            const mappedRecord = mapRestaurantRecord({ cityName, citySlug, contextLabel, restaurantCard });
            if (!mappedRecord?.restaurantId || seenRestaurantIds.has(mappedRecord.restaurantId)) continue;

            seenRestaurantIds.add(mappedRecord.restaurantId);
            collectedRecords.push(mappedRecord);
        } catch (error) {
            log.warning(`Skipping malformed restaurant card: ${error.message}`);
        }
    }
}

async function fetchJson(client, url, refererUrl) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt++) {
        try {
            const response = await client.fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                ...(refererUrl && {
                    headers: {
                        Origin: SWIGGY_BASE_URL,
                        Referer: refererUrl,
                    },
                }),
            });

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.statusCode = response.status;
                error.retryAfterMs = getRetryAfterMs(response);
                throw error;
            }

            const payload = await response.json();
            if (!payload || typeof payload !== 'object') {
                throw new Error('Unexpected JSON response shape.');
            }

            return payload;
        } catch (error) {
            lastError = error;
            const statusCode = error.statusCode || error.response?.status;
            log.warning(`Request failed for ${new URL(url).pathname}${statusCode ? ` with HTTP ${statusCode}` : ''}: ${error.message}`);

            if (attempt < MAX_REQUEST_ATTEMPTS && isRetryableRequestError(error)) {
                const delayMs = getRetryDelayMs(error, attempt);
                log.info(`Retrying request in ${delayMs}ms (attempt ${attempt + 1}/${MAX_REQUEST_ATTEMPTS}).`);
                await new Promise((resolve) => {
                    setTimeout(resolve, delayMs);
                });
            } else {
                break;
            }
        }
    }

    throw lastError;
}

function isRetryableRequestError(error) {
    const statusCode = error.statusCode || error.response?.status;
    if (!statusCode) return true;

    return statusCode === 403
        || statusCode === 408
        || statusCode === 425
        || statusCode === 429
        || statusCode >= 500;
}

function getRetryDelayMs(error, attempt) {
    if (Number.isFinite(error.retryAfterMs)) {
        return Math.min(Math.max(error.retryAfterMs, 0), MAX_RETRY_DELAY_MS);
    }

    const statusCode = error.statusCode || error.response?.status;
    let baseDelayMs = 500;
    if (statusCode === 429) {
        baseDelayMs = 2000;
    } else if (statusCode >= 500) {
        baseDelayMs = 1000;
    }

    return Math.min(attempt * baseDelayMs, MAX_RETRY_DELAY_MS);
}

function getRetryAfterMs(response) {
    const retryAfter = response.headers?.get?.('retry-after');
    if (!retryAfter) return undefined;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;

    const retryAt = Date.parse(retryAfter);
    return Number.isFinite(retryAt) ? retryAt - Date.now() : undefined;
}

function buildCoordinateTargets(resolvedLocation, maxPages, prioritizeCoverage = false) {
    const targets = [{ lat: resolvedLocation.lat, lng: resolvedLocation.lng }];
    const { boundingBox } = resolvedLocation;

    if (!boundingBox || maxPages <= 1) {
        return targets;
    }

    const centerLat = (boundingBox.south + boundingBox.north) / 2;
    const centerLng = (boundingBox.west + boundingBox.east) / 2;
    const candidateTargets = prioritizeCoverage
        ? [
            { lat: boundingBox.south, lng: boundingBox.west },
            { lat: boundingBox.south, lng: boundingBox.east },
            { lat: boundingBox.north, lng: boundingBox.west },
            { lat: boundingBox.north, lng: boundingBox.east },
            { lat: centerLat, lng: centerLng },
            { lat: boundingBox.south, lng: centerLng },
            { lat: boundingBox.north, lng: centerLng },
            { lat: centerLat, lng: boundingBox.west },
            { lat: centerLat, lng: boundingBox.east },
        ]
        : [
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

function buildListingUrl(lat, lng) {
    const listingUrl = new URL(SWIGGY_LISTING_ENDPOINT);
    listingUrl.searchParams.set('lat', String(lat));
    listingUrl.searchParams.set('lng', String(lng));
    listingUrl.searchParams.set('is-seo-homepage-enabled', 'true');
    listingUrl.searchParams.set('page_type', 'DESKTOP_WEB_LISTING');
    return listingUrl.toString();
}

function buildCityUrl(citySlug) {
    return `${SWIGGY_BASE_URL}/city/${citySlug}`;
}

function collectListingCards(payload) {
    const cards = getResponseCards(payload);
    const mainGridCards = cards
        .filter((card) => card?.card?.card?.id === 'restaurant_grid_listing_v2')
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
    visitValue(getResponseCards(payload), (value) => {
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
    visitValue(getResponseCards(payload), (value) => {
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
    const data = getCaseInsensitiveProperty(payload, 'data');
    const cards = getResponseCards(payload);
    const dataKeys = data && typeof data === 'object' ? Object.keys(data) : [];
    const topLevelCardCount = cards.length;
    const groupKeys = new Set();

    visitValue(cards, (value) => {
        if (value?.cardGroupMap && typeof value.cardGroupMap === 'object') {
            for (const key of Object.keys(value.cardGroupMap)) {
                groupKeys.add(key);
            }
        }
    });

    return JSON.stringify({
        topLevelKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
        dataKeys,
        topLevelCardCount,
        groupKeys: [...groupKeys],
    });
}

function getResponseCards(payload) {
    const data = getCaseInsensitiveProperty(payload, 'data');
    const cards = getCaseInsensitiveProperty(data, 'cards');
    return Array.isArray(cards) ? cards : [];
}

function getCaseInsensitiveProperty(value, key) {
    if (!value || typeof value !== 'object') return undefined;

    const matchingKey = Object.keys(value).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return matchingKey ? value[matchingKey] : undefined;
}

function normalizeRestaurantId(value) {
    if (value === null || value === undefined) return undefined;

    const normalizedId = String(value).trim();
    return normalizedId || undefined;
}

function mapRestaurantRecord({ cityName, citySlug, contextLabel, restaurantCard }) {
    const info = restaurantCard?.info || {};
    const cta = restaurantCard?.cta || {};
    const slugs = info.slugs || {};

    return sanitizeRecord({
        sourceType: contextLabel,
        restaurantId: normalizeRestaurantId(info.id),
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
