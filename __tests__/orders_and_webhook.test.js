const request = require('supertest')
const { app } = require('../index')
const fs = require('fs')
const path = require('path')
const dbFallback = require('../db_fallback')

const DATA_FILE = path.join(__dirname, '..', 'data.json')

beforeEach(() => {
  try { fs.unlinkSync(DATA_FILE) } catch (e) {}
  dbFallback.init()
})

test('create order and list orders', async () => {
  const order = { items: [{ sku: 'p1-s1', quantity: 1, price: 10 }], total: 10 }
  const res = await request(app).post('/api/v1/orders').send(order).set('Accept', 'application/json')
  expect(res.status).toBe(201)
  expect(res.body.id).toBeTruthy()

  const list = await request(app).get('/api/v1/orders')
  expect(list.status).toBe(200)
  expect(Array.isArray(list.body)).toBe(true)
  const found = list.body.find(o => o.id === res.body.id)
  expect(found).toBeTruthy()
})

test('orders create returns 500 when DB errors', async () => {
  const db = require('../db_fallback')
  const orig = db.createOrder
  db.createOrder = () => { throw new Error('boom') }
  const order = { items: [], total: 0 }
  const res = await request(app).post('/api/v1/orders').send(order).set('Accept', 'application/json')
  expect(res.status).toBe(500)
  // restore
  db.createOrder = orig
})

test('webhook endpoint accepts raw body when not configured', async () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } })
  const res = await request(app).post('/api/v1/webhooks/payment').set('Content-Type', 'application/json').send(payload)
  expect(res.status).toBe(200)
  expect(res.body.received).toBeTruthy()
})

test('signup missing fields returns 400 and login invalid returns 401', async () => {
  const s = await request(app).post('/api/v1/signup').send({}).set('Accept', 'application/json')
  expect(s.status).toBe(400)

  const l = await request(app).post('/api/v1/login').send({ email: 'noone@example.com', password: 'x' }).set('Accept', 'application/json')
  expect(l.status).toBe(401)
})

test('release reservations missing orderId returns 400', async () => {
  const r = await request(app).post('/api/v1/reservations/release').send({}).set('Accept', 'application/json')
  expect(r.status).toBe(400)
})
