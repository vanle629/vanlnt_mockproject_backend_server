/* eslint-env node,jest */
const request = require('supertest')

describe('Integration tests (order reservation & payment)', () => {
  let app
  beforeEach(() => {
    process.env.FORCE_DB_FALLBACK = '1'
    delete require.cache[require.resolve('../../index')]
    app = require('../../index').app
  })

  test('order reserved then paid (local)', async () => {
    // pick an inventory item
    const inv = await request(app).get('/api/v1/inventory')
    const sku = Object.keys(inv.body.inventory || {})[0]
    expect(sku).toBeTruthy()

    // create checkout (local flow marks paid)
    const r = await request(app).post('/api/v1/checkout/session').send({ items: [{ sku, quantity: 1, price: 5, title: 'it' }] })
    expect(r.status).toBe(200)

    // check orders reflect paid status
    const list = await request(app).get('/api/v1/orders')
    expect(list.status).toBe(200)
    const paid = list.body.find(o => o.status === 'paid')
    expect(paid).toBeTruthy()
  })
})
