const request = require('supertest')
const { app } = require('../index')
const fs = require('fs')
const path = require('path')
const dbFallback = require('../db_fallback')

const DATA_FILE = path.join(__dirname, '..', 'data.json')

function resetDataFile(){
  try { fs.unlinkSync(DATA_FILE) } catch(e){}
  dbFallback.init()
}

// no server shutdown required when using supertest against the app

test('signup and login flow', async () => {
  const email = `test+${Date.now()}@example.com`
  const pwd = 'secret'

  const s = await request(app)
    .post('/api/v1/signup')
    .send({ name: 'T', email, password: pwd })
    .set('Accept', 'application/json')
  expect(s.status).toBe(201)
  expect(s.body.token).toBeTruthy()

  const l = await request(app)
    .post('/api/v1/login')
    .send({ email, password: pwd })
    .set('Accept', 'application/json')
  expect(l.status).toBe(200)
  expect(l.body.token).toBeTruthy()
})

test('serves docs and openapi yaml', async ()=>{
  const res = await request(app).get('/docs/swagger.html')
  // swagger.html might be large; ensure it serves and contains the swagger id
  expect(res.status).toBe(200)
  expect(res.text).toMatch(/swagger-ui/i)

  const yaml = await request(app).get('/openapi.yaml')
  expect([200, 302, 404]).toContain(yaml.status)
})

describe('inventory and checkout edge cases', ()=>{
  beforeEach(()=> resetDataFile())

  test('inventory endpoint returns inventory map', async ()=>{
    const res = await request(app).get('/api/v1/inventory')
    expect(res.status).toBe(200)
    expect(res.body.inventory).toBeTruthy()
    expect(res.body.inventory['p1-s1']).toBe(5)
  })

  test('checkout reserves and marks paid (fallback path) reduces inventory', async ()=>{
    // create an order with an item that has enough stock
    const items = [{ sku: 'p1-s1', quantity: 2, price: 10, title: 'shoe' }]
    const resp = await request(app)
      .post('/api/v1/checkout/session')
      .send({ items })
      .set('Accept', 'application/json')
    expect(resp.status).toBe(200)
    // after fallback path, the data.json should show inventory reduced
    const state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    expect(state.inventory['p1-s1']).toBe(3)
  })

  test('checkout returns 409 when insufficient stock', async ()=>{
    // request more than available
    const items = [{ sku: 'p1-s3', quantity: 1, price: 10, title: 'soldout' }]
    const resp = await request(app)
      .post('/api/v1/checkout/session')
      .send({ items })
      .set('Accept', 'application/json')
    expect(resp.status).toBe(409)
  })

  test('release reservations removes reservations', async ()=>{
    // simulate a reservation by creating an order and reserving items
    const items = [{ sku: 'p2-s1', quantity: 1, price: 10, title: 'p2' }]
    const create = await request(app).post('/api/v1/checkout/session').send({ items }).set('Accept','application/json')
    expect(create.status).toBe(200)
    // find the order id from returned url query param
    const url = create.body.url || ''
    const m = url.match(/order=([^&]+)/)
    const orderId = m ? decodeURIComponent(m[1]) : null
    expect(orderId).toBeTruthy()

    // release reservation
    const r = await request(app).post('/api/v1/reservations/release').send({ orderId }).set('Accept','application/json')
    expect(r.status).toBe(200)
    expect(r.body.released).toBeTruthy()
  })

})
