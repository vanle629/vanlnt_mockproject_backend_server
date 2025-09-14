const fs = require('fs')
const path = require('path')

const DATA_FILE = path.join(__dirname, 'data.json')

function readState(){
  try {
    if (!fs.existsSync(DATA_FILE)) return null
    const raw = fs.readFileSync(DATA_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (e) { return null }
}

function writeState(state){
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8')
}

function init(){
  if (fs.existsSync(DATA_FILE)) return
  const state = {
    inventory: { 'p1-s1':5,'p1-s2':10,'p1-s3':0,'p2-s1':3,'p2-s2':2,'p3-s1':7 },
    orders: [],
    reservations: []
  }
  writeState(state)
}

function getInventory(){
  const s = readState() || {}
  return s.inventory || {}
}

function reserveItems(orderId, reservations){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  // Consider existing reservations when checking availability
  const reservedMap = {}
  for (const ex of (s.reservations || [])) {
    reservedMap[ex.sku] = (reservedMap[ex.sku] || 0) + (ex.qty || 0)
  }

  // Check availability against inventory minus already reserved quantities
  for (const r of reservations){
    const available = s.inventory[r.sku] || 0
    const alreadyReserved = reservedMap[r.sku] || 0
    if ((available - alreadyReserved) < r.qty) return false
    // reserve in the map to account for multiple items in the same request
    reservedMap[r.sku] = alreadyReserved + r.qty
  }

  // Insert reservation records
  for (const r of reservations){
    s.reservations.push({ orderId, sku: r.sku, qty: r.qty })
  }
  writeState(s)
  return true
}

function applyPayment(orderId){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  const res = s.reservations.filter(r => r.orderId === orderId)
  for (const r of res){
    s.inventory[r.sku] = Math.max(0, (s.inventory[r.sku] || 0) - r.qty)
  }
  s.reservations = s.reservations.filter(r => r.orderId !== orderId)
  writeState(s)
}

function createOrder(order){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  const stored = Object.assign({}, order)
  stored.total = Math.round((order.total||0)*100)
  s.orders.push(stored)
  writeState(s)
}

function getOrders(){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  return (s.orders || []).map(o => ({ ...o, total: (o.total||0)/100 }))
}

function releaseReservations(orderId){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  s.reservations = s.reservations.filter(r => r.orderId !== orderId)
  writeState(s)
}

function updateOrderPayment(orderId, payment, status = 'pending'){
  const s = readState() || { inventory: {}, orders: [], reservations: [] }
  for (const o of s.orders){
    if (o.id === orderId){
      o.payment = payment
      o.status = status
    }
  }
  writeState(s)
}

function markOrderPaid(orderId, payment){
  applyPayment(orderId)
  updateOrderPayment(orderId, payment, 'paid')
}

module.exports = { init, getInventory, reserveItems, applyPayment, createOrder, getOrders, releaseReservations, updateOrderPayment, markOrderPaid }
