const fs = require('fs')
const path = require('path')

const LOG_DIR = path.join(__dirname, '..', 'logs')
const LOG_FILE = path.join(LOG_DIR, 'maintenance.log')

function ensure(){
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR)
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '')
}

function info(msg, meta){
  ensure()
  const entry = { ts: new Date().toISOString(), level: 'info', msg, meta }
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
}

function error(msg, meta){
  ensure()
  const entry = { ts: new Date().toISOString(), level: 'error', msg, meta }
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
}

module.exports = { info, error, LOG_FILE }
