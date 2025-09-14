# SoleMate Mock Backend

This small Express server provides demo endpoints used by the frontend during development:

- `POST /api/v1/checkout/session` - creates a demo order and returns a confirmation URL
- `POST /api/v1/orders` - create an order
- `POST /api/v1/webhooks/payment` - webhook stub (logs payload)
- `GET /api/v1/orders` - list demo orders

Run locally:

```bash
cd vanlnt_mockproject_backend_server
npm install
npm start
```

Test checkout session endpoint:

```bash
curl -X POST http://localhost:8000/api/v1/checkout/session -H 'Content-Type: application/json' -d '{"items": [{"sku":"p1-s2","quantity":1,"price":99}], "shipping": {"name":"Test","address":"1 Main St"}}'
```

Test webhook:

```bash
curl -X POST http://localhost:8000/api/v1/webhooks/payment -H 'Content-Type: application/json' -d '{"type":"payment_intent.succeeded"}'
```
