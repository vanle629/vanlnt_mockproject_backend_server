/* eslint-env node,jest */
const request = require('supertest')

describe('Functional tests (SRS core flows)', () => {
  let app
  beforeAll(() => {
    process.env.FORCE_DB_FALLBACK = '1'
    delete require.cache[require.resolve('../../index')]
    app = require('../../index').app
  })

  test('signup and login flow', async () => {
    const email = `test+${Date.now()}@example.com`
    const pw = 'password123'
    const s = await request(app).post('/api/v1/signup').send({ name: 'Test', email, password: pw })
    expect([201,200]).toContain(s.status)

    const l = await request(app).post('/api/v1/login').send({ email, password: pw })
    expect(l.status).toBe(200)
    expect(l.body && l.body.token).toBeTruthy()
  })

  test('inventory and checkout basic flow', async () => {
    const inv = await request(app).get('/api/v1/inventory')
    expect(inv.status).toBe(200)
    const keys = Object.keys(inv.body.inventory || {})
    expect(keys.length).toBeGreaterThan(0)

    // pick a product with qty >=1
    const sku = keys.find(k => (inv.body.inventory[k] || 0) > 0)
    expect(sku).toBeTruthy()

    const resp = await request(app).post('/api/v1/checkout/session').send({ items: [{ sku, quantity: 1, price: 10, title: 'test' }] })
    // service returns URL for confirmation or Stripe URL
    expect(resp.status).toBe(200)
    expect(resp.body && (resp.body.url || resp.body.checkout_url)).toBeTruthy()
  })
})
