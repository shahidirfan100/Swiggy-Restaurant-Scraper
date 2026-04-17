# Swiggy Restaurant Scraper

Extract restaurant listings from Swiggy city pages and keyword searches in a structured, repeatable format. Collect restaurant names, cuisines, ratings, delivery estimates, areas, discounts, and restaurant links for research, local market analysis, and competitive tracking.

## Features

- **City URL support** — Collect restaurants from Swiggy city and city collection URLs.
- **Keyword discovery** — Search for restaurant matches around a resolved city using dish or cuisine keywords.
- **Rich restaurant fields** — Gather ratings, cuisines, delivery estimates, pricing hints, badges, and image links.
- **Clean datasets** — Empty and null fields are removed before data is saved.
- **Proxy-ready runs** — Supports Apify proxy configuration for stable production runs.

## Use Cases

### Local Market Research
Track which restaurants appear for a city and compare their ratings, cuisine mix, and delivery promises. Use the output to understand how crowded a local category is.

### Cuisine Trend Monitoring
Search for keywords such as biryani, pizza, burgers, or desserts and build datasets of restaurants associated with those demand clusters. This is useful for food startups, cloud kitchens, and neighborhood analysis.

### Competitive Benchmarking
Capture restaurant visibility, pricing hints, and delivery expectations across cities or neighborhoods. The data helps benchmark how brands position themselves in different zones.

### Lead Generation
Build restaurant lists for outreach, partnerships, or account mapping. The dataset includes location and restaurant URLs, making it easier to review each listing.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `"https://www.swiggy.com/city/bangalore"` | A Swiggy city or city collection URL. This is the best option for city browsing runs. |
| `keyword` | String | No | `"biryani"` | Restaurant or dish keyword to search around the resolved city. |
| `location` | String | No | `"Bangalore"` | Fallback location when you are not using a Swiggy URL. |
| `resultsWanted` | Integer | No | `20` | Maximum number of restaurants to save. |
| `maxPages` | Integer | No | `3` | Maximum number of page expansions in URL mode when more city results are available. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": true}` | Apify proxy configuration. |

## Output Data

Each dataset item can contain:

| Field | Type | Description |
|-------|------|-------------|
| `restaurantId` | String | Swiggy restaurant identifier |
| `name` | String | Restaurant name |
| `url` | String | Restaurant page URL |
| `sourceType` | String | `city_listing` or `keyword_search` |
| `city` | String | Resolved city name |
| `citySlug` | String | Swiggy city slug |
| `locality` | String | Restaurant locality |
| `areaName` | String | Restaurant area |
| `address` | String | Address when available |
| `cuisines` | Array | Cuisine labels |
| `costForTwo` | String | Cost-for-two text |
| `avgRating` | Number | Average rating |
| `avgRatingString` | String | Rating as shown by Swiggy |
| `totalRatingsString` | String | Rating count text |
| `deliveryTime` | Integer | Estimated delivery time in minutes |
| `minDeliveryTime` | Integer | Minimum estimated delivery time |
| `maxDeliveryTime` | Integer | Maximum estimated delivery time |
| `lastMileTravelKm` | Number | Last-mile travel distance |
| `slaString` | String | Delivery estimate text |
| `isOpen` | Boolean | Whether the restaurant is open |
| `nextCloseTime` | String | Next closing time when available |
| `parentId` | String | Parent brand identifier |
| `cloudinaryImageId` | String | Swiggy image identifier |
| `imageUrl` | String | Restaurant image URL |
| `discountSummary` | String | Discount summary text |
| `badges` | Array | Badge descriptions |
| `externalRating` | String | External rating when available |
| `externalRatingCount` | String | External rating count when available |
| `matchedDishes` | Array | Up to five matching dishes for keyword runs |

## Usage Examples

### Basic City Run

```json
{
	"url": "https://www.swiggy.com/city/bangalore",
	"resultsWanted": 20,
	"maxPages": 2
}
```

### Keyword Search Around a City URL

```json
{
	"url": "https://www.swiggy.com/city/bangalore/best-restaurants",
	"keyword": "pizza",
	"resultsWanted": 25
}
```

### Location-Based Search Without URL

```json
{
	"location": "Koramangala Bangalore",
	"keyword": "desserts",
	"resultsWanted": 15
}
```

## Sample Output

```json
{
	"sourceType": "keyword_search",
	"restaurantId": "18972",
	"name": "Nandhana Palace",
	"url": "https://www.swiggy.com/city/bangalore/nandhana-palace-indiranagar-indiranagar-rest18972",
	"city": "Bangalore",
	"citySlug": "bangalore",
	"locality": "Indiranagar",
	"areaName": "Indiranagar",
	"cuisines": [
		"Biryani",
		"Andhra",
		"South Indian",
		"North Indian"
	],
	"costForTwo": "₹500 FOR TWO",
	"avgRating": 4.4,
	"avgRatingString": "4.4",
	"totalRatingsString": "32K+",
	"deliveryTime": 53,
	"slaString": "50-60 MINS",
	"isOpen": true,
	"imageUrl": "https://media-assets.swiggy.com/swiggy/image/upload/RX_THUMBNAIL/IMAGES/VENDOR/2024/11/21/9ea12882-e49f-49d2-92e9-0b2f7cdb79b3_18972.jpg",
	"matchedDishes": [
		{
			"name": "Bowl Hyderabadi Paneer Biryani",
			"category": "Bowl Biryani",
			"price": "INR 245.00",
			"rating": "4.6"
		}
	]
}
```

## Tips for Best Results

### Use Real Swiggy City URLs
- Prefer `https://www.swiggy.com/city/<city>` style URLs for browsing runs.
- City URLs provide the strongest result expansion support.

### Keep Result Limits Reasonable
- Start with `20` to validate the dataset shape.
- Increase `resultsWanted` after confirming the target city or keyword works as expected.

### Use Proxies for Stability
- Residential proxies are recommended when you want the most reliable browser-assisted expansions.
- Proxy support is especially helpful when collecting larger city runs.

## Proxy Configuration

```json
{
	"proxyConfiguration": {
		"useApifyProxy": true,
		"apifyProxyGroups": ["RESIDENTIAL"]
	}
}
```

## Integrations

- **Google Sheets** — Export restaurant datasets for analysis and reporting.
- **Airtable** — Build searchable restaurant databases.
- **Make** — Send restaurant data into automated workflows.
- **Zapier** — Trigger downstream enrichment and notifications.
- **Webhooks** — Deliver fresh datasets to your own systems.

### Export Formats

- **JSON** — For APIs and application workflows.
- **CSV** — For spreadsheets and tabular analysis.
- **Excel** — For business reporting.
- **XML** — For integration pipelines.

## Frequently Asked Questions

### Can I run the actor with only a keyword?
Use a keyword together with a Swiggy URL or a location. The actor needs a city context to resolve the correct search area.

### Which URLs work best?
Swiggy city URLs and city collection URLs work best, such as the main city page and best-restaurants pages.

### Why are some fields missing from certain restaurants?
Swiggy does not expose every field for every listing. The actor removes empty values instead of saving null placeholders.

### Does the actor collect dish data too?
The main output is restaurant-focused. For keyword runs, the actor also includes a short list of matching dishes that helped surface each restaurant.

### Can I collect every restaurant in a city?
You can collect a substantial number of restaurants, but actual coverage depends on the target city, keyword, and how many additional page expansions Swiggy exposes during the run.

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Apify Scheduling](https://docs.apify.com/platform/schedules)

## Legal Notice

This actor is intended for legitimate data collection and analysis. Users are responsible for complying with applicable laws, platform terms, and internal data-governance requirements.