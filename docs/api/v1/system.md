# System runtime manifest v1

`GET /v1/system/runtime-manifest` is the only Web-facing System projection.
The BFF resolves `KOKORO_DOMAIN` through IAM tenant binding, calls the System
owner with trusted service context, validates the owner response, and performs
one transport projection into snake_case.

Required query fields:

- `product_id`
- `locale`
- `surface_id`

The browser cannot choose `tenant_id`, host authority, or service credentials.
Browser-supplied `X-Domain`, `Host`, `X-Forwarded-*`, tenant, and actor headers
are not forwarded as authority.

Success uses the canonical v1 envelope:

```json
{
  "data": {
    "tenant_id": "TENANT_ID",
    "product_id": "kokoro",
    "locale": "en-US",
    "navigation": [],
    "locale_namespaces": [],
    "theme": {},
    "feature_flags": [],
    "references": [],
    "config_version": "1",
    "release_id": null,
    "digest": "DIGEST"
  },
  "meta": {
    "request_id": "REQUEST_ID"
  }
}
```

Owner failures are normalized into the BFF error envelope. The route never
falls back to a browser-provided tenant or an in-memory production fact.
