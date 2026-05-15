/**
 * Database module - PostgreSQL for production, SQLite for local dev
 */

const path = require('path')

const DATABASE_URL = process.env.DATABASE_URL

let db = null
let initialized = false
let isPostgres = false

async function initDb() {
  if (initialized) return db

  if (DATABASE_URL) {
    // PostgreSQL mode
    isPostgres = true
    const { Pool } = require('pg')
    db = new Pool({ 
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    })
    
    console.log('💾 Using PostgreSQL')
    
    // Create tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        username TEXT,
        keeta_address TEXT,
        encrypted_seed TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS tips (
        id SERIAL PRIMARY KEY,
        from_user_id BIGINT NOT NULL,
        to_user_id BIGINT NOT NULL,
        amount TEXT NOT NULL,
        token TEXT DEFAULT 'KTA',
        tx_hash TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS payment_links (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        default_amount TEXT,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        link_id INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        tx_hash TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

  } else {
    // SQLite mode for local dev
    isPostgres = false
    const initSqlJs = require('sql.js')
    const fs = require('fs')
    
    const DB_PATH = path.join(__dirname, '..', 'keetatip.db')
    const SQL = await initSqlJs()

    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH)
      db = new SQL.Database(buffer)
      console.log('💾 SQLite loaded from disk')
    } else {
      db = new SQL.Database()
      console.log('💾 Creating new SQLite database')
    }

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

    saveSqlite()
  }

  initialized = true
  console.log('✅ Database initialized')
  return db
}

function saveSqlite() {
  if (db && !isPostgres) {
    const fs = require('fs')
    const DB_PATH = path.join(__dirname, '..', 'keetatip.db')
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(DB_PATH, buffer)
  }
}

// Unified wrapper that works with both Postgres and SQLite
const dbWrapper = {
  prepare: (sql) => ({
    run: async (...params) => {
      if (!db) throw new Error('DB not initialized')
      
      if (isPostgres) {
        // Convert ? to $1, $2, etc for postgres
        let pgSql = sql
        let i = 1
        while (pgSql.includes('?')) {
          pgSql = pgSql.replace('?', `$${i++}`)
        }
        const result = await db.query(pgSql, params)
        return { lastInsertRowid: result.rows[0]?.id }
      } else {
        db.run(sql, params)
        saveSqlite()
        const result = db.exec('SELECT last_insert_rowid() as id')
        return { lastInsertRowid: result[0]?.values[0]?.[0] }
      }
    },
    get: async (...params) => {
      if (!db) throw new Error('DB not initialized')
      
      if (isPostgres) {
        let pgSql = sql
        let i = 1
        while (pgSql.includes('?')) {
          pgSql = pgSql.replace('?', `$${i++}`)
        }
        const result = await db.query(pgSql, params)
        return result.rows[0]
      } else {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        if (stmt.step()) {
          const row = stmt.getAsObject()
          stmt.free()
          return row
        }
        stmt.free()
        return undefined
      }
    },
    all: async (...params) => {
      if (!db) throw new Error('DB not initialized')
      
      if (isPostgres) {
        let pgSql = sql
        let i = 1
        while (pgSql.includes('?')) {
          pgSql = pgSql.replace('?', `$${i++}`)
        }
        const result = await db.query(pgSql, params)
        return result.rows
      } else {
        const stmt = db.prepare(sql)
        stmt.bind(params)
        const rows = []
        while (stmt.step()) {
          rows.push(stmt.getAsObject())
        }
        stmt.free()
        return rows
      }
    }
  })
}

module.exports = dbWrapper
module.exports.initDb = initDb
module.exports.save = saveSqlite
