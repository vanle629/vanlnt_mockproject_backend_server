/* eslint-env node */
const fetch = require('node-fetch')

const base = 'http://localhost:8000'

async function run(){
  console.log('SQLi test (signup)')
  const sqli = { name: 'att', email: "x' OR '1'='1", password: 'p' }
  try {
    const r = await fetch(`${base}/api/v1/signup`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(sqli) })
    console.log('status', r.status)
  } catch (e) { console.error(e) }

  console.log('XSS test (orders)')
  const xss = { id: 'ORDER-xss', items: [{ sku: 'p1-s1', quantity:1, price:1, title: "<script>alert(1)</script>" }], total: 1 }
  try {
    const r = await fetch(`${base}/api/v1/orders`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(xss) })
    console.log('status', r.status)
  } catch (e) { console.error(e) }
}

run()
