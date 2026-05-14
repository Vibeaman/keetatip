/**
 * Database module using sql.js
 */

const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'keetatip.db')

let db = null
let initialized = false

async function initDb() {
  if (initialized) return db

  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
    console.log('💾 Database loaded from disk')
  } else {
    db = new SQL.Database()
    console.log('💾 Creating new database')
  }

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      keeta_address TEXT,
      encrypted_seed TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Tips table
  db.run(`
    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL,
      to_user_id INTEGER NOT NULL,
      amount TEXT NOT NULL,
      token TEXT DEFAULT 'KTA',
      tx_hash TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Payment links table
  db.run(`
    CREATE TABLE IF NOT EXISTS payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      default_amount TEXT,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Payments received via links
  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL,
      from_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  save()
  initialized = true
  console.log('✅ Database initialized')
  return db
}

function save() {
  if (db) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(DB_PATH, buffer)
  }
}

// Wrapper for sync-style API
const dbWrapper = {
  prepare: (sql) => ({
    run: (...params) => {
      if (!db) throw new Error('DB not initialized')
      const isInsert = sql.trim().toUpperCase().startsWith('INSERT')
      db.run(sql, params)
      save()
      if (isInsert) {
        const result = db.exec('SELECT last_insert_rowid() as id')
        const id = result[0]?.values[0]?.[0]
        return { lastInsertRowid: id }
      }
      return {}
    },
    get: (...params) => {
      if (!db) throw new Error('DB not initialized')
      const stmt = db.prepare(sql)
      stmt.bind(params)
      if (stmt.step()) {
        const row = stmt.getAsObject()
        stmt.free()
        return row
      }
      stmt.free()
      return undefined
    },
    all: (...params) => {
      if (!db) throw new Error('DB not initialized')
      const stmt = db.prepare(sql)
      stmt.bind(params)
      const rows = []
      while (stmt.step()) {
        rows.push(stmt.getAsObject())
      }
      stmt.free()
      return rows
    }
  })
}

module.exports = dbWrapper
module.exports.initDb = initDb
module.exports.save = save
