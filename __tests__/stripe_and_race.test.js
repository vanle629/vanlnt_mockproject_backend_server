/* eslint-env node,jest */
const request = require('supertest')
const fs = require('fs')
const path = require('path')
const dbFallback = require('../db_fallback')

const DATA_FILE = path.join(__dirname, '..', 'data.json')

function resetDataFile(){
  try { fs.unlinkSync(DATA_FILE) } catch(e){}
  dbFallback.init()
}

describe('Stripe integration and reservation race', ()=>{
  beforeEach(()=>{
    resetDataFile()
    delete require.cache[require.resolve('../index')]
  })

  test('webhook signature verification (valid and invalid)', async ()=>{
    jest.isolateModules(() => {
      process.env.FORCE_DB_FALLBACK = '1'
      process.env.STRIPE_SECRET = 'sk_test'
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
      // mock stripe factory
      jest.mock('stripe', () => {
        return jest.fn(() => ({
          webhooks: {
            constructEvent: (raw, sig, secret) => {
              if (sig !== 'validsig' || secret !== 'whsec_test') throw new Error('invalid signature')
              return { type: 'checkout.session.completed', data: { object: { metadata: { orderId: 'ORDER-manual' }, id: 'sess_1' } } }
            }
          },
          checkout: { sessions: { create: async () => ({ id: 'sess_1', url: 'https://checkout.test/sess_1' }) } }
        }))
      })
    })

    // require after mocking
    const { app } = require('../index')

    // create an order with known id
    const ord = { id: 'ORDER-manual', items: [], total: 0 }
    const create = await request(app).post('/api/v1/orders').send(ord).set('Accept','application/json')
    expect(create.status).toBe(201)

    // send invalid signature
    const bad = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'badsig')
      .send(JSON.stringify({}))
    expect(bad.status).toBe(400)

    // send valid signature
    const good = await request(app)
      .post('/api/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'validsig')
      .send(JSON.stringify({}))
    expect(good.status).toBe(200)

    // order should be marked paid
    const list = await request(app).get('/api/v1/orders')
    const found = list.body.find(o => o.id === 'ORDER-manual')
    expect(found).toBeTruthy()
    expect(found.status).toBe('paid')
  })

  test('checkout uses Stripe session when configured', async ()=>{
    jest.isolateModules(() => {
      process.env.FORCE_DB_FALLBACK = '1'
      process.env.STRIPE_SECRET = 'sk_test'
      // mock stripe create
      jest.mock('stripe', () => jest.fn(() => ({
        webhooks: { constructEvent: () => { /* not used */ } },
        checkout: { sessions: { create: async (opts) => ({ id: 'sess_2', url: 'https://checkout.test/sess_2' }) } }
      })))
    })
    const { app } = require('../index')

    const items = [{ sku: 'p1-s2', quantity: 1, price: 20, title: 'shoe' }]
    const resp = await request(app).post('/api/v1/checkout/session').send({ items }).set('Accept','application/json')
    expect(resp.status).toBe(200)
    expect(resp.body.url).toMatch(/checkout.test/)
  })

  test('multi-item reservation race: one succeeds, other fails when stock limited', async ()=>{
    // Use fallback DB default: p2-s1 qty 3
    const { app } = require('../index')
    const items = [{ sku: 'p2-s1', quantity: 2, price: 10, title: 'p2' }]

    // send two requests in parallel
    const [a, b] = await Promise.all([
      request(app).post('/api/v1/checkout/session').send({ items }).set('Accept','application/json'),
      request(app).post('/api/v1/checkout/session').send({ items }).set('Accept','application/json')
    ])
    const statuses = [a.status, b.status]
    // One should be 200, the other 409
    expect(statuses.filter(s => s === 200).length).toBe(1)
    expect(statuses.filter(s => s === 409).length).toBe(1)
  })

})
