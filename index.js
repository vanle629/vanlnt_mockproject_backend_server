
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const app = express()
app.use(cors())
// JSON parser for normal routes
app.use(bodyParser.json())

// Simple users persistence for mock signup/login
const USERS_FILE = path.join(__dirname, 'users.json')
function loadUsers(){
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]') } catch(e) { return [] }
}
function saveUsers(users){
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)) } catch(e) { console.warn('Failed to write users file', e && e.message) }
}
function hashPwd(pwd){ return crypto.createHash('sha256').update(String(pwd || '')).digest('hex') }

// Signup - stores a minimal user record and returns a demo token
app.post('/api/v1/signup', (req, res) => {
  const { name, email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'missing_email_or_password' })
  const users = loadUsers()
  if (users.find(u => u.email === email)) return res.status(409).json({ error: 'user_exists' })
  const user = { id: `u-${Date.now()}`, name: name || '', email, password: hashPwd(password), created_at: new Date().toISOString() }
  users.push(user)
  saveUsers(users)
  // Return a simple mock token (not secure) expected by the frontend
  const token = Buffer.from(`${user.id}:${email}:${Date.now()}`).toString('base64')
  return res.status(201).json({ token })
})

// Login - validate credentials against stored users and return token
app.post('/api/v1/login', (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'missing_email_or_password' })
  const users = loadUsers()
  const user = users.find(u => u.email === email && u.password === hashPwd(password))
  if (!user) return res.status(401).json({ error: 'invalid_credentials' })
  const token = Buffer.from(`${user.id}:${email}:${Date.now()}`).toString('base64')
  return res.json({ token })
})

// Optional Stripe integration. If STRIPE_SECRET is set, we'll use the Stripe SDK.
const stripeSecret = process.env.STRIPE_SECRET || ''
let stripe = null
if (stripeSecret) {
  try {
    stripe = require('stripe')(stripeSecret)
    console.log('Stripe enabled in mock backend')
  } catch (err) {
    console.warn('Stripe SDK not available or failed to initialize:', err && err.message)
    stripe = null
  }
}

// Use SQLite persistence for inventory, orders, and reservations
let db
try {
  // Allow tests to force the fallback DB for deterministic file-based state
  if (process.env.FORCE_DB_FALLBACK === '1') throw new Error('forced-fallback')
  db = require('./db')
  db.init()
} catch (err) {
  console.warn('Using file-based fallback DB (db_fallback)', err && err.message)
  db = require('./db_fallback')
  db.init()
}

function availableStockMap(){
  return db.getInventory() // returns { sku: qty }
}

app.post('/api/v1/checkout/session', async (req, res) => {
  const { items = [], shipping = {}, successUrl = '/', cancelUrl = '/' } = req.body || {}

  // Compute order total
  const total = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 0), 0)

  // Create an order record (persisted)
  const orderId = `ORDER-${Date.now()}`
  const order = { id: orderId, items, shipping, total, status: 'created', created_at: new Date().toISOString() }
  // Persist order skeleton
  try {
    db.createOrder(order)
  } catch (err) {
    console.error('Failed to create order in DB:', err && err.message)
    return res.status(500).json({ error: 'db_error' })
  }

  // Inventory reservation step: try to reserve requested SKUs using DB transaction
  const reservations = (items || []).map(it => ({ sku: it.sku || it.skuId || it.product || it.productId, qty: Number(it.quantity || 1) })).filter(r => r.sku)
  const reserved = db.reserveItems(orderId, reservations)
  if (!reserved) {
    return res.status(409).json({ error: 'insufficient_stock' })
  }
  order.reservations = reservations
  order.status = reservations.length ? 'reserved' : order.status
  // update DB order status to reserved
  db.updateOrderPayment(orderId, null, order.status)

  // If Stripe is configured, create a Checkout Session and attach orderId in metadata
  if (stripe) {
    try {
      const line_items = (items || []).map(i => ({
        price_data: {
          currency: 'usd',
          product_data: { name: i.title || i.sku || i.product || i.productId || 'Item' },
          unit_amount: Math.round((i.price || 0) * 100)
        },
        quantity: i.quantity || 1
      }))

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items,
        success_url: successUrl || `${req.protocol}://${req.get('host')}/`,
        cancel_url: cancelUrl || `${req.protocol}://${req.get('host')}/cart`,
        metadata: { orderId }
      })

    // update order with stripe session reference
  order.payment = { provider: 'stripe', session_id: session.id }
  order.status = 'pending'
  db.updateOrderPayment(orderId, order.payment, 'pending')

      return res.json({ url: session.url })
    } catch (err) {
      console.error('Stripe session creation failed, falling back to local confirmation:', err && err.message)
      // fall through to demo confirmation URL
    }
  }

  // Fallback: return a local confirmation URL for demo/testing
  // If we're falling back (no Stripe), mark order as paid and decrement stock immediately for demo
  if (!stripe) {
    // No external payment provider: mark paid and apply reservations immediately
    try {
      db.markOrderPaid(orderId, { provider: 'local', received_at: new Date().toISOString() })
      order.status = 'paid'
    } catch (err) {
      console.error('Failed to mark order paid in DB:', err && err.message)
      return res.status(500).json({ error: 'db_error' })
    }
  }

  return res.json({ url: `${req.protocol}://${req.get('host')}/checkout/confirmation?order=${encodeURIComponent(orderId)}` })
})

app.post('/api/v1/orders', (req, res) => {
  const order = req.body || {}
  order.id = order.id || `ORDER-${Date.now()}`
  order.created_at = new Date().toISOString()
  try {
    db.createOrder(order)
    res.status(201).json(order)
  } catch (err) {
    console.error('Failed to create order:', err && err.message)
    res.status(500).json({ error: 'db_error' })
  }
})

// Webhook endpoint: use raw body so Stripe signature verification works when configured
app.post('/api/v1/webhooks/payment', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || ''

  if (stripe && webhookSecret) {
    const sig = req.headers['stripe-signature']
    let event
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
    } catch (err) {
      console.error('⚠️  Webhook signature verification failed.', err && err.message)
      return res.status(400).send(`Webhook Error: ${err && err.message}`)
    }

    console.log('Received Stripe webhook event:', event.type)

    // Example handling for checkout.session.completed
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const orderId = session.metadata && session.metadata.orderId
      if (orderId) {
        try {
          // mark order paid and apply reservations atomically in DB
          db.markOrderPaid(orderId, { provider: 'stripe', session_id: session.id, received_at: new Date().toISOString() })
          console.log(`Order ${orderId} marked as paid and inventory updated (DB)`)
        } catch (err) {
          console.error('Failed to mark order paid in DB:', err && err.message)
        }
      }
    }

    return res.json({ received: true })
  }

  // No webhook verification configured — accept and log body
  try {
    const body = req.body && req.body.toString ? req.body.toString() : req.body
    console.log('received webhook (no verification configured):', body)
  } catch (e) {}
  res.json({ received: true })
})

app.get('/api/v1/orders', (req, res) => {
  try {
    const rows = db.getOrders()
    res.json(rows)
  } catch (err) {
    console.error('Failed to fetch orders:', err && err.message)
    res.status(500).json({ error: 'db_error' })
  }
})

// Debug: get current inventory and reservations
app.get('/api/v1/inventory', (req, res) => {
  try {
    const inventory = db.getInventory()
    res.json({ inventory })
  } catch (err) {
    console.error('Failed to fetch inventory:', err && err.message)
    res.status(500).json({ error: 'db_error' })
  }
})

// Debug: release reservations for an order id (useful in testing)
app.post('/api/v1/reservations/release', (req, res) => {
  const { orderId } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'missing_orderId' })
  try {
    db.releaseReservations(orderId)
    res.json({ released: true })
  } catch (err) {
    console.error('Failed to release reservations:', err && err.message)
    res.status(500).json({ error: 'db_error' })
  }
})

const port = process.env.PORT || 8000

// Start server only when run directly
let server = null
if (require.main === module) {
  server = app.listen(port, () => console.log('Mock backend listening on port', port))
}

// Export for tests
module.exports = { app }

// Serve the docs folder and OpenAPI YAML
const docsPath = path.join(__dirname, '..', 'docs')
try {
  if (fs.existsSync(docsPath)) {
    app.use('/docs', express.static(docsPath))
    // expose the YAML at /openapi/catalog.yaml and a convenience /openapi.yaml
    const openapiSrc = path.join(docsPath, 'openapi', 'catalog.yaml')
    if (fs.existsSync(openapiSrc)) {
      app.get('/openapi/catalog.yaml', (req, res) => res.sendFile(openapiSrc))
      app.get('/openapi.yaml', (req, res) => res.sendFile(openapiSrc))
    }
  }
} catch (e) {
  console.warn('Docs not served:', e && e.message)
}
