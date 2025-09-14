const path = require('path')
const fs = require('fs')

const DB_FILE = path.join(__dirname, 'data.sqlite')
const exists = fs.existsSync(DB_FILE)
const Database = require('better-sqlite3')
const db = new Database(DB_FILE)

function init(){
  // create tables if not exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (sku TEXT PRIMARY KEY, qty INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, total INTEGER, status TEXT, created_at TEXT, payment TEXT);
    CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, sku TEXT, qty INTEGER, price INTEGER);
    CREATE TABLE IF NOT EXISTS reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, sku TEXT, qty INTEGER);
  `)

  // seed inventory if DB newly created
  if (!exists) {
    const seed = db.prepare('INSERT INTO inventory (sku, qty) VALUES (?, ?)')
    const items = [['p1-s1',5],['p1-s2',10],['p1-s3',0],['p2-s1',3],['p2-s2',2],['p3-s1',7]]
    const insert = db.transaction(() => { for (const it of items) seed.run(it[0], it[1]) })
    insert()
  }
}

function getInventory(){
  const rows = db.prepare('SELECT sku, qty FROM inventory').all()
  const map = {}
  for (const r of rows) map[r.sku] = r.qty
  return map
}

function reserveItems(orderId, reservations){
  const getQty = db.prepare('SELECT qty FROM inventory WHERE sku = ?')
  const dec = db.prepare('UPDATE inventory SET qty = qty - ? WHERE sku = ? AND qty >= ?')
  const insRes = db.prepare('INSERT INTO reservations (order_id, sku, qty) VALUES (?, ?, ?)')

  const tx = db.transaction(() => {
    for (const r of reservations){
      const row = getQty.get(r.sku)
      const available = row ? row.qty : 0
      if (available < r.qty) throw new Error('insufficient')
    }
    for (const r of reservations){
      insRes.run(orderId, r.sku, r.qty)
    }
  })

  try { tx(); return true } catch(e) { return false }
}

function applyPayment(orderId){
  const selectRes = db.prepare('SELECT sku, qty FROM reservations WHERE order_id = ?')
  const rows = selectRes.all(orderId)
  const dec = db.prepare('UPDATE inventory SET qty = qty - ? WHERE sku = ?')
  const delRes = db.prepare('DELETE FROM reservations WHERE order_id = ?')
  const tx = db.transaction(() => {
    for (const r of rows){
      dec.run(r.qty, r.sku)
    }
    delRes.run(orderId)
  })
  tx()
}

function releaseReservations(orderId){
  const delRes = db.prepare('DELETE FROM reservations WHERE order_id = ?')
  delRes.run(orderId)
}

function updateOrderPayment(orderId, payment, status = 'pending'){
  const upd = db.prepare('UPDATE orders SET payment = ?, status = ? WHERE id = ?')
  upd.run(payment ? JSON.stringify(payment) : null, status, orderId)
}

function markOrderPaid(orderId, payment){
  // applyPayment will decrement inventory and delete reservations
  const tx = db.transaction(() => {
    applyPayment(orderId)
    const upd = db.prepare('UPDATE orders SET status = ?, payment = ? WHERE id = ?')
    upd.run('paid', payment ? JSON.stringify(payment) : null, orderId)
  })
  tx()
}

function createOrder(order){
  const ins = db.prepare('INSERT INTO orders (id, total, status, created_at, payment) VALUES (?, ?, ?, ?, ?)')
  ins.run(order.id, Math.round((order.total||0)*100), order.status || 'created', order.created_at || new Date().toISOString(), order.payment ? JSON.stringify(order.payment) : null)
  const insItem = db.prepare('INSERT INTO order_items (order_id, sku, qty, price) VALUES (?, ?, ?, ?)')
  for (const it of order.items || []){
    insItem.run(order.id, it.sku || it.skuId || it.product || it.productId || null, it.quantity || 1, Math.round((it.price||0)*100))
  }
}

function getOrders(){
  return db.prepare('SELECT id, total, status, created_at, payment FROM orders').all().map(r => ({...r, total: r.total/100, payment: r.payment ? JSON.parse(r.payment) : null}))
}

module.exports = { init, getInventory, reserveItems, applyPayment, createOrder, getOrders, releaseReservations, updateOrderPayment, markOrderPaid, db }
