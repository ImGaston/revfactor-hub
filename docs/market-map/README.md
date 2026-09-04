# RevFactor Market Map data contract

The internal map consumes `GET /api/market-map` while authenticated with the
`market_signals:view` permission. The response is read-only and intentionally
redacted: it contains coordinates, city/state, assignment labels, provenance,
and an opaque `map_key`; it never contains street addresses, client names,
Airbnb URLs, or provider listing IDs.

```json
{
  "version": 1,
  "generated_at": "2026-09-03T00:00:00.000Z",
  "read_only": true,
  "points": [{
    "map_key": "opaque-key",
    "city": "Gatlinburg",
    "state": "TN",
    "country": "US",
    "latitude": 35.7143,
    "longitude": -83.5103,
    "location_precision": "exact",
    "location_source": "pricelabs",
    "location_observed_at": "2026-09-03T00:00:00.000Z",
    "market": { "name": "Smoky Mountains", "status": "active" },
    "locality": { "name": "Gatlinburg", "status": "active" },
    "assignment_confidence": "reviewed"
  }]
}
```

Grok should treat missing coordinates as unmapped, render `exact` and
`approximate` points differently, and keep the map read-only. Refreshing the
endpoint replaces sample data; it must not write back to Hub.
