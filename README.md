## What does Swiggy Restaurant Scraper do?

Swiggy Restaurant Scraper is a Swiggy restaurant data extractor for collecting structured restaurant listings across Indian cities. Provide a Swiggy city or city collection URL, or provide a location with an optional food or cuisine keyword, and receive restaurant names, cuisines, ratings, delivery estimates, pricing hints, offers, areas, and restaurant URLs in an Apify dataset.

The Actor is useful for restaurant market research, cuisine discovery, competitor monitoring, local business intelligence, and lead-list building. Each result is saved as a clean record, with empty values omitted when Swiggy does not publish a field.

## Why use Swiggy Restaurant Scraper?

- **City-level restaurant discovery** - Collect restaurants visible in a Swiggy city or city collection page.
- **Cuisine and dish research** - Search for terms such as `biryani`, `pizza`, `burgers`, or `desserts` around a resolved city.
- **Competitive benchmarking** - Compare ratings, cuisines, cost-for-two text, delivery estimates, badges, and discounts across areas.
- **Local market mapping** - Build datasets for neighborhoods, restaurant partnerships, cloud-kitchen research, or food delivery analysis.
- **Automation-ready output** - Download JSON, CSV, Excel, or XML, schedule repeat runs, use webhooks, and connect the dataset to other Apify workflows.
- **Flexible collection limits** - Control the number of saved restaurants and the geographic expansion limit for broader city coverage.

## What data can you extract from Swiggy?

The dataset contains one item per restaurant. Keyword runs can also include up to five matching dishes for each restaurant.

| Field | Type | Description |
|-------|------|-------------|
| `restaurantId` | String | Swiggy restaurant identifier |
| `name` | String | Restaurant name |
| `url` | String | Direct Swiggy restaurant page URL |
| `sourceType` | String | `city_listing` or `keyword_search` |
| `city` | String | Resolved city name |
| `citySlug` | String | Swiggy city slug |
| `locality` | String | Restaurant locality |
| `areaName` | String | Restaurant area or neighborhood |
| `address` | String | Address when available |
| `cuisines` | Array | Cuisine labels shown for the restaurant |
| `costForTwo` | String | Cost-for-two text shown by Swiggy |
| `avgRating` | Number or String | Average rating value |
| `avgRatingString` | String | Rating formatted as shown by Swiggy |
| `totalRatingsString` | String | Rating count text, such as `32K+` |
| `deliveryTime` | Integer | Estimated delivery time in minutes |
| `minDeliveryTime` | Integer | Minimum estimated delivery time |
| `maxDeliveryTime` | Integer | Maximum estimated delivery time |
| `lastMileTravelKm` | Number | Estimated last-mile distance in kilometers |
| `slaString` | String | Delivery estimate text |
| `isOpen` | Boolean | Whether the restaurant is currently open when available |
| `nextCloseTime` | String | Next closing time when available |
| `parentId` | String | Parent brand identifier when available |
| `cloudinaryImageId` | String | Swiggy image identifier |
| `imageUrl` | String | Restaurant image URL |
| `discountSummary` | String | Discount or offer summary |
| `badges` | Array | Badge descriptions shown for the restaurant |
| `externalRating` | String | External rating when available |
| `externalRatingCount` | String | External rating count when available |
| `matchedDishes` | Array | Matching dish details for keyword searches |

## How to scrape Swiggy restaurant data

1. Open Swiggy Restaurant Scraper on Apify.
2. Enter a Swiggy city URL, or enter a location if you are not using a URL.
3. Add an optional keyword for a dish, cuisine, or restaurant search.
4. Set `resultsWanted` and `maxPages` for the size and coverage you need.
5. Run the Actor and review the dataset preview.
6. Export the results or connect them to a scheduled workflow, webhook, or integration.

At least one of `url` or `location` must provide the city context. A keyword by itself is not enough because Swiggy search results need a city location.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | String | No | `https://www.swiggy.com/city/bangalore` | Swiggy city or city collection URL. Use this for city browsing and city-specific searches. |
| `keyword` | String | No | `biryani` | Optional restaurant, dish, or cuisine keyword. |
| `location` | String | No | `Bangalore` | City, area, or location used when a Swiggy URL is not provided. |
| `resultsWanted` | Integer | No | `20` | Maximum number of restaurant records to save. |
| `maxPages` | Integer | No | `3` | Maximum number of geographic or page expansion attempts used to find more results. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional Apify Proxy settings for repeated or larger runs. |

## Usage Examples

### Basic city collection

Collect restaurants from a Swiggy city page:

```json
{
  "url": "https://www.swiggy.com/city/bangalore",
  "resultsWanted": 20,
  "maxPages": 2
}
```

### Keyword search around a city

Find restaurants associated with a food keyword while keeping the result set tied to a Swiggy city:

```json
{
  "url": "https://www.swiggy.com/city/bangalore/best-restaurants",
  "keyword": "pizza",
  "resultsWanted": 25
}
```

### Location-based cuisine search

Use a location without a URL and search for a specific cuisine or dish:

```json
{
  "location": "Koramangala Bangalore",
  "keyword": "desserts",
  "resultsWanted": 15,
  "maxPages": 3
}
```

### Larger run with Apify Proxy

Enable Apify Proxy when collecting a larger dataset or running repeated monitoring jobs:

```json
{
  "url": "https://www.swiggy.com/city/mumbai",
  "resultsWanted": 100,
  "maxPages": 5,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Sample Output

This is an example of one dataset item from a keyword search. Fields that are unavailable for a particular restaurant are omitted.

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
  "minDeliveryTime": 50,
  "maxDeliveryTime": 60,
  "slaString": "50-60 MINS",
  "isOpen": true,
  "imageUrl": "https://media-assets.swiggy.com/swiggy/image/upload/RX_THUMBNAIL/IMAGES/VENDOR/2024/11/21/9ea12882-e49f-49d2-92e9-0b2f7cdb79b3_18972.jpg",
  "matchedDishes": [
    {
      "name": "Bowl Hyderabadi Paneer Biryani",
      "category": "Bowl Biryani",
      "description": "Paneer biryani bowl",
      "price": "INR 245.00",
      "finalPrice": "INR 220.00",
      "rating": "4.6",
      "ratingCount": "120",
      "inStock": true,
      "isVeg": true
    }
  ]
}
```

## Tips for best results

- **Use a complete city URL** - Prefer a URL such as `https://www.swiggy.com/city/bangalore` or a current Swiggy city collection URL for broad restaurant discovery.
- **Start with a small limit** - Test with `resultsWanted` between `10` and `20`, then increase it after confirming the city and output shape.
- **Use focused keywords** - Cuisine and dish terms such as `biryani`, `pizza`, `south indian`, and `desserts` are useful for targeted research.
- **Increase `maxPages` gradually** - A higher value can broaden geographic coverage, but the number of available listings depends on Swiggy and the selected city.
- **Expect source-dependent fields** - Ratings, offers, images, addresses, and delivery values are not published for every restaurant. Missing values are removed from the record.
- **Schedule repeat runs for monitoring** - Compare datasets over time to track restaurant visibility, delivery estimates, ratings, and offers.

## Integrations and export formats

- **Google Sheets** - Review restaurant lists, compare cities, and share market research.
- **Airtable** - Build a searchable restaurant directory with filters for cuisine, rating, area, or delivery time.
- **Make or Zapier** - Trigger enrichment, notifications, or follow-up workflows.
- **Webhooks** - Send completed run results to your own service.
- **Apify API** - Access datasets programmatically from applications and data pipelines.

| Format | Best for |
|--------|----------|
| JSON | APIs, nested `matchedDishes`, and application workflows |
| CSV | Spreadsheet analysis and lead lists |
| Excel | Business reporting and sharing |
| XML | Structured system imports |

## Frequently Asked Questions

### Can I run the Actor with only a keyword?

No. Add a Swiggy city URL or a `location` value so the keyword search has a city context.

### Which Swiggy URLs work best?

Swiggy city URLs and city collection URLs work best, including pages such as `https://www.swiggy.com/city/bangalore` and current city category pages.

### Does the Actor collect menu items?

The primary output is restaurant-focused. Keyword searches can include up to five matching dishes with names, categories, prices, ratings, availability, and related details when Swiggy provides them.

### Can I collect every restaurant in a city?

Coverage depends on the city, available listings, keyword, result limit, and expansion options exposed by Swiggy. Use a higher `resultsWanted` value and increase `maxPages` gradually for broader collection.

### Why are some output fields missing?

Swiggy does not provide every field for every listing. The Actor omits empty values so the dataset remains compact and easier to process.

### Can I run this Actor on a schedule?

Yes. Create an Apify schedule to run it hourly, daily, weekly, or at another interval, then compare the resulting datasets for monitoring and reporting.

### Is it legal to collect Swiggy data?

Public web data collection can be subject to laws, privacy requirements, and website terms. You are responsible for using the dataset lawfully and respecting Swiggy's terms, access controls, and applicable data-governance rules.

## Related Actors

- [Food Panda Scraper](https://apify.com/shahidirfan/food-panda-scraper) - Collect restaurant listings, menus, prices, ratings, delivery estimates, and reviews from Foodpanda Pakistan.
- [OpenTable Scraper](https://apify.com/shahidirfan/opentable-scraper) - Collect restaurant listings, cuisine types, ratings, review counts, locations, and dining details from OpenTable.

## Support

For issues, feature requests, or unexpected output, use the Issues tab on the Actor page or contact the developer through Apify. Include the input URL, the input values, and a small example of the affected output when reporting a problem.

## Legal Notice

This Actor is intended for legitimate research, analysis, and business data workflows using publicly available information. Users are responsible for complying with applicable laws, Swiggy's terms of service, privacy rules, and any restrictions related to collecting, storing, or using restaurant data.
