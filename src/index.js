/**
 * KeetaTip - Main Entry Point
 * Runs both Telegram bot and Web server
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

console.log('🚀 Starting KeetaTip...')

// Start both services
require('./bot')
const { startServer } = require('./server')

startServer().catch(console.error)
