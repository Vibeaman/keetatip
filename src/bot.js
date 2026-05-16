/**
 * KeetaTip Telegram Bot
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const TelegramBot = require('node-telegram-bot-api')
const { initDb } = require('./db')
const db = require('./db')
const { encryptSeed, decryptSeed } = require('./crypto')
const keeta = require('./keeta')

const BOT_TOKEN = process.env.BOT_TOKEN
const BASE_URL = process.env.BASE_URL || 'https://keetatip.xyz'

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env')
  process.exit(1)
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true })

// User state for multi-step flows
const userState = new Map()

// Main menu keyboard
const mainMenu = {
  inline_keyboard: [
    [{ text: '💰 Balance', callback_data: 'balance' }],
    [{ text: '📤 Send', callback_data: 'send' }, { text: '📥 Receive', callback_data: 'receive' }],
    [{ text: '💸 Tip', callback_data: 'tip' }, { text: '🔗 My Link', callback_data: 'mylink' }],
    [{ text: '📜 History', callback_data: 'history' }, { text: '🏆 Leaderboard', callback_data: 'leaderboard' }]
  ]
}

async function start() {
  await initDb()
  console.log('💾 Database ready')

  // /start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    const telegramUsername = msg.from.username || msg.from.first_name

    console.log(`👋 /start from ${telegramUsername} (${userId})`)

    try {
      // Check if user exists
      let user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      
      console.log(`🔍 User lookup for ${userId}:`, user ? 'FOUND' : 'NOT FOUND')

      if (!user) {
        // New user - ask them to choose a username
        userState.set(userId, { step: 'choose_username', telegramUsername })
        await bot.sendMessage(chatId,
          `👋 <b>Welcome to KeetaTip!</b>\n\n` +
          `Let's set up your wallet.\n\n` +
          `First, choose a <b>username</b> for your tip link:\n` +
          `• Letters and numbers only (a-z, 0-9)\n` +
          `• 3-15 characters\n` +
          `• Example: <code>john</code>, <code>alice99</code>\n\n` +
          `Your tip link will be:\n<code>${BASE_URL}/yourname</code>`,
          { parse_mode: 'HTML' }
        )
        return
      }

      // Existing user - show welcome back
      const link = await db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
      const tipUrl = link ? `${BASE_URL}/${link.slug}` : null
      
      await bot.sendMessage(chatId,
        `🎉 <b>KeetaTip</b>\n\n` +
        `Welcome back, <b>${user.username}</b>!\n\n` +
        `💳 <code>${user.keeta_address}</code>` +
        (tipUrl ? `\n🔗 <a href="${tipUrl}">${tipUrl}</a>` : ''),
        { parse_mode: 'HTML', reply_markup: mainMenu }
      )
    } catch (e) {
      console.error('Start error:', e)
      await bot.sendMessage(chatId, '❌ Error. Please try again.')
    }
  })

  // /balance command
  bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    try {
      const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      if (!user) {
        await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
        return
      }
      
      await bot.sendMessage(chatId, '⏳ Fetching balance...')
      
      const seed = decryptSeed(user.encrypted_seed, userId.toString())
      const balance = await keeta.getBalance(seed)
      
      let text = '💰 <b>Your Balance</b>\n\n'
      if (typeof balance === 'object') {
        for (const [token, amount] of Object.entries(balance)) {
          text += `• ${token}: ${amount}\n`
        }
      } else {
        text += `• KTA: ${balance}\n`
      }
      
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
    } catch (e) {
      console.error('Balance command error:', e)
      await bot.sendMessage(chatId, '❌ Error fetching balance.', { reply_markup: mainMenu })
    }
  })

  // /mylink command
  bot.onText(/\/mylink|\/link/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    try {
      const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      if (!user) {
        await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
        return
      }
      
      const link = await db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
      
      if (link) {
        const fullUrl = `${BASE_URL}/${link.slug}`
        await bot.sendMessage(chatId,
          `🔗 <b>Your Payment Link</b>\n\n` +
          `<a href="${fullUrl}">${fullUrl}</a>\n\n` +
          `Share this link to receive tips!`,
          { parse_mode: 'HTML', reply_markup: mainMenu }
        )
      } else {
        await bot.sendMessage(chatId, '❌ No payment link found.', { reply_markup: mainMenu })
      }
    } catch (e) {
      console.error('MyLink command error:', e)
      await bot.sendMessage(chatId, '❌ Error.', { reply_markup: mainMenu })
    }
  })

  // /send command
  bot.onText(/\/send(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) {
      await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
      return
    }
    
    userState.set(userId, { step: 'send_address' })
    await bot.sendMessage(chatId,
      '📤 <b>Send KTA</b>\n\n' +
      'Enter the recipient address or @username:',
      { parse_mode: 'HTML' }
    )
  })

  // /tip command - /tip @username amount
  bot.onText(/\/tip(?:\s+@(\w+)\s+([\d.]+))?/, async (msg, match) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) {
      await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
      return
    }
    
    if (match && match[1] && match[2]) {
      // Direct tip: /tip @user 5
      const targetUsername = match[1].toLowerCase()
      const amount = parseFloat(match[2])
      
      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount.')
        return
      }
      
      const toUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(targetUsername)
      if (!toUser) {
        await bot.sendMessage(chatId, '❌ User not found. They need to /start the bot first.', { reply_markup: mainMenu })
        return
      }
      
      await bot.sendMessage(chatId, `⏳ Tipping @${targetUsername} ${amount} KTA...`)
      
      try {
        const seed = decryptSeed(user.encrypted_seed, userId.toString())
        const result = await keeta.sendTokens(seed, toUser.keeta_address, amount)
        
        if (result.success) {
          await db.prepare(`
            INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
            VALUES (?, ?, ?, ?)
          `).run(userId, toUser.telegram_id, amount.toString(), result.txHash)
          
          try {
            await bot.sendMessage(toUser.telegram_id,
              `💸 <b>You received a tip!</b>\n\n` +
              `From: @${user.username}\n` +
              `Amount: ${amount} KTA`,
              { parse_mode: 'HTML' }
            )
          } catch (e) { }
          
          await bot.sendMessage(chatId,
            `✅ <b>Tipped @${targetUsername}!</b>\n\nAmount: ${amount} KTA`,
            { parse_mode: 'HTML', reply_markup: mainMenu }
          )
        } else {
          await bot.sendMessage(chatId, `❌ Failed: ${result.error}`, { reply_markup: mainMenu })
        }
      } catch (e) {
        console.error('Tip error:', e)
        await bot.sendMessage(chatId, '❌ Error tipping.', { reply_markup: mainMenu })
      }
    } else {
      // Start tip flow
      userState.set(userId, { step: 'tip_user' })
      await bot.sendMessage(chatId,
        '💸 <b>Tip a User</b>\n\n' +
        'Enter @username and amount:\n' +
        'Example: <code>@john 5</code>',
        { parse_mode: 'HTML' }
      )
    }
  })

  // /receive command
  bot.onText(/\/receive/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) {
      await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
      return
    }
    
    const link = await db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
    const tipUrl = link ? `${BASE_URL}/${link.slug}` : `${BASE_URL}/user${userId}`
    
    await bot.sendMessage(chatId,
      `📥 <b>Receive KTA</b>\n\n` +
      `Your address:\n<code>${user.keeta_address}</code>\n\n` +
      `Share this address to receive KTA.\n\n` +
      `🔗 Or share your tip link:\n<a href="${tipUrl}">${tipUrl}</a>`,
      { parse_mode: 'HTML', reply_markup: mainMenu }
    )
  })

  // /history command
  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) {
      await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
      return
    }
    
    const tips = await db.prepare(`
      SELECT t.*, 
        (SELECT username FROM users WHERE telegram_id = t.from_user_id) as from_user,
        (SELECT username FROM users WHERE telegram_id = t.to_user_id) as to_user
      FROM tips t
      WHERE t.from_user_id = ? OR t.to_user_id = ?
      ORDER BY t.created_at DESC
      LIMIT 10
    `).all(userId, userId)
    
    if (tips.length === 0) {
      await bot.sendMessage(chatId, '📜 No transaction history yet.', { reply_markup: mainMenu })
      return
    }
    
    let text = '📜 <b>Recent Transactions</b>\n\n'
    for (const tip of tips) {
      const direction = tip.from_user_id === userId ? '📤' : '📥'
      const other = tip.from_user_id === userId ? tip.to_user : tip.from_user
      text += `${direction} ${tip.amount} ${tip.token} ${tip.from_user_id === userId ? 'to' : 'from'} @${other}\n`
    }
    
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
  })

  // /leaderboard command
  bot.onText(/\/leaderboard/, async (msg) => {
    const chatId = msg.chat.id
    
    const topTippers = await db.prepare(`
      SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
      FROM tips t
      JOIN users u ON t.from_user_id = u.telegram_id
      GROUP BY t.from_user_id, u.username
      ORDER BY total DESC
      LIMIT 10
    `).all()
    
    const topReceivers = await db.prepare(`
      SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
      FROM tips t
      JOIN users u ON t.to_user_id = u.telegram_id
      GROUP BY t.to_user_id, u.username
      ORDER BY total DESC
      LIMIT 10
    `).all()
    
    let text = '🏆 <b>Leaderboard</b>\n\n'
    
    text += '<b>Top Tippers:</b>\n'
    if (topTippers.length === 0) {
      text += '<i>No tips yet</i>\n'
    } else {
      topTippers.forEach((t, i) => {
        text += `${i + 1}. @${t.username} - ${t.total} KTA\n`
      })
    }
    
    text += '\n<b>Top Receivers:</b>\n'
    if (topReceivers.length === 0) {
      text += '<i>No tips yet</i>\n'
    } else {
      topReceivers.forEach((r, i) => {
        text += `${i + 1}. @${r.username} - ${r.total} KTA\n`
      })
    }
    
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
  })

  // /setusername command - change username
  bot.onText(/\/setusername(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id
    const userId = msg.from.id
    
    const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) {
      await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
      return
    }
    
    if (match && match[1]) {
      // Direct: /setusername newname
      const newUsername = match[1].trim().toLowerCase()
      
      if (newUsername.length < 3 || newUsername.length > 15) {
        await bot.sendMessage(chatId, '❌ Username must be 3-15 characters.')
        return
      }
      
      if (!/^[a-z0-9]+$/.test(newUsername)) {
        await bot.sendMessage(chatId, '❌ Only letters (a-z) and numbers (0-9) allowed.')
        return
      }
      
      const existingUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ? AND telegram_id != ?').get(newUsername, userId)
      const existingLink = await db.prepare('SELECT * FROM payment_links WHERE slug = ? AND user_id != ?').get(newUsername, userId)
      
      if (existingUser || existingLink) {
        await bot.sendMessage(chatId, `❌ Username "${newUsername}" is already taken.`)
        return
      }
      
      // Update username and payment link
      await db.prepare('UPDATE users SET username = ? WHERE telegram_id = ?').run(newUsername, userId)
      await db.prepare('UPDATE payment_links SET slug = ? WHERE user_id = ?').run(newUsername, userId)
      
      const tipUrl = `${BASE_URL}/${newUsername}`
      await bot.sendMessage(chatId,
        `✅ Username changed to <b>${newUsername}</b>!\n\n` +
        `🔗 New tip link: <a href="${tipUrl}">${tipUrl}</a>`,
        { parse_mode: 'HTML', reply_markup: mainMenu }
      )
    } else {
      // Start flow
      userState.set(userId, { step: 'set_username' })
      await bot.sendMessage(chatId,
        `👤 <b>Change Username</b>\n\n` +
        `Current: <b>${user.username}</b>\n\n` +
        `Enter new username (3-15 chars, a-z and 0-9 only):`,
        { parse_mode: 'HTML' }
      )
    }
  })

  // /help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id
    
    await bot.sendMessage(chatId,
      `📖 <b>KeetaTip Commands</b>\n\n` +
      `/start - Create wallet & show menu\n` +
      `/balance - Check your KTA balance\n` +
      `/send - Send KTA to address or @user\n` +
      `/tip @user amount - Tip a user\n` +
      `/receive - Show your address & tip link\n` +
      `/mylink - Get your payment link\n` +
      `/setusername - Change your username\n` +
      `/history - View transaction history\n` +
      `/leaderboard - Top tippers & receivers\n\n` +
      `<b>Group Tipping:</b>\n` +
      `Reply to a message with <code>$tip 5</code> to tip 5 KTA`,
      { parse_mode: 'HTML', reply_markup: mainMenu }
    )
  })

  // Handle button presses
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id
    const userId = query.from.id
    const data = query.data

    await bot.answerCallbackQuery(query.id)

    try {
      const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      if (!user) {
        await bot.sendMessage(chatId, '❌ Please /start first to create a wallet.')
        return
      }

      // Balance
      if (data === 'balance') {
        await bot.sendMessage(chatId, '⏳ Fetching balance...')

        try {
          const seed = decryptSeed(user.encrypted_seed, userId.toString())
          const balance = await keeta.getBalance(seed)

          let text = '💰 <b>Your Balance</b>\n\n'
          if (typeof balance === 'object') {
            for (const [token, amount] of Object.entries(balance)) {
              text += `• ${token}: ${amount}\n`
            }
          } else {
            text += `• KTA: ${balance}\n`
          }

          await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
        } catch (e) {
          console.error('Balance error:', e)
          await bot.sendMessage(chatId, '❌ Error fetching balance.', { reply_markup: mainMenu })
        }
        return
      }

      // Receive
      if (data === 'receive') {
        const link = await db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
        const tipUrl = link ? `${BASE_URL}/${link.slug}` : `${BASE_URL}/user${userId}`
        
        await bot.sendMessage(chatId,
          `📥 <b>Receive KTA</b>\n\n` +
          `Your address:\n<code>${user.keeta_address}</code>\n\n` +
          `Share this address to receive KTA.\n\n` +
          `🔗 Or share your tip link:\n<a href="${tipUrl}">${tipUrl}</a>`,
          { parse_mode: 'HTML', reply_markup: mainMenu }
        )
        return
      }

      // My Link
      if (data === 'mylink') {
        const link = await db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
        
        if (link) {
          const fullUrl = `${BASE_URL}/${link.slug}`
          await bot.sendMessage(chatId,
            `🔗 <b>Your Payment Link</b>\n\n` +
            `<a href="${fullUrl}">${fullUrl}</a>\n\n` +
            `Share this link to receive tips!`,
            { parse_mode: 'HTML', reply_markup: mainMenu }
          )
        } else {
          await bot.sendMessage(chatId, '❌ No payment link found.', { reply_markup: mainMenu })
        }
        return
      }

      // Send - start flow
      if (data === 'send') {
        userState.set(userId, { step: 'send_address' })
        await bot.sendMessage(chatId,
          '📤 <b>Send KTA</b>\n\n' +
          'Enter the recipient address or @username:',
          { parse_mode: 'HTML' }
        )
        return
      }

      // Tip - same as send but for @mentions
      if (data === 'tip') {
        userState.set(userId, { step: 'tip_user' })
        await bot.sendMessage(chatId,
          '💸 <b>Tip a User</b>\n\n' +
          'Enter @username and amount:\n' +
          'Example: <code>@john 5</code>',
          { parse_mode: 'HTML' }
        )
        return
      }

      // History
      if (data === 'history') {
        const tips = await db.prepare(`
          SELECT t.*, 
            (SELECT username FROM users WHERE telegram_id = t.from_user_id) as from_user,
            (SELECT username FROM users WHERE telegram_id = t.to_user_id) as to_user
          FROM tips t
          WHERE t.from_user_id = ? OR t.to_user_id = ?
          ORDER BY t.created_at DESC
          LIMIT 10
        `).all(userId, userId)

        if (tips.length === 0) {
          await bot.sendMessage(chatId, '📜 No transaction history yet.', { reply_markup: mainMenu })
          return
        }

        let text = '📜 <b>Recent Transactions</b>\n\n'
        for (const tip of tips) {
          const direction = tip.from_user_id === userId ? '📤' : '📥'
          const other = tip.from_user_id === userId ? tip.to_user : tip.from_user
          text += `${direction} ${tip.amount} ${tip.token} ${tip.from_user_id === userId ? 'to' : 'from'} @${other}\n`
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
        return
      }

      // Leaderboard
      if (data === 'leaderboard') {
        const topTippers = await db.prepare(`
          SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
          FROM tips t
          JOIN users u ON t.from_user_id = u.telegram_id
          GROUP BY t.from_user_id, u.username
          ORDER BY total DESC
          LIMIT 10
        `).all()

        const topReceivers = await db.prepare(`
          SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
          FROM tips t
          JOIN users u ON t.to_user_id = u.telegram_id
          GROUP BY t.to_user_id, u.username
          ORDER BY total DESC
          LIMIT 10
        `).all()

        let text = '🏆 <b>Leaderboard</b>\n\n'
        
        text += '<b>Top Tippers:</b>\n'
        if (topTippers.length === 0) {
          text += '<i>No tips yet</i>\n'
        } else {
          topTippers.forEach((t, i) => {
            text += `${i + 1}. @${t.username} - ${t.total} KTA\n`
          })
        }

        text += '\n<b>Top Receivers:</b>\n'
        if (topReceivers.length === 0) {
          text += '<i>No tips yet</i>\n'
        } else {
          topReceivers.forEach((r, i) => {
            text += `${i + 1}. @${r.username} - ${r.total} KTA\n`
          })
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: mainMenu })
        return
      }
    } catch (e) {
      console.error('Callback error:', e)
      await bot.sendMessage(chatId, '❌ Error. Please try again.', { reply_markup: mainMenu })
    }
  })

  // Handle text messages (for flows)
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return

    const userId = msg.from.id
    const chatId = msg.chat.id
    const state = userState.get(userId)

    if (!state) return

    try {
      // Handle username selection for new users
      if (state.step === 'choose_username') {
        const chosenUsername = msg.text?.trim().toLowerCase()
        
        // Validate username
        if (!chosenUsername || chosenUsername.length < 3 || chosenUsername.length > 15) {
          await bot.sendMessage(chatId, '❌ Username must be 3-15 characters. Try again:')
          return
        }
        
        if (!/^[a-z0-9]+$/.test(chosenUsername)) {
          await bot.sendMessage(chatId, '❌ Only letters (a-z) and numbers (0-9) allowed. Try again:')
          return
        }
        
        // Check if username is taken
        const existingUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(chosenUsername)
        const existingLink = await db.prepare('SELECT * FROM payment_links WHERE slug = ?').get(chosenUsername)
        
        if (existingUser || existingLink) {
          await bot.sendMessage(chatId, `❌ Username "${chosenUsername}" is already taken. Try another:`)
          return
        }
        
        // Create wallet
        await bot.sendMessage(chatId, '🔐 Creating your Keeta wallet...')
        
        const wallet = keeta.createWallet()
        const encryptedSeed = encryptSeed(wallet.seed, userId.toString())
        
        await db.prepare(`
          INSERT INTO users (telegram_id, username, keeta_address, encrypted_seed)
          VALUES (?, ?, ?, ?)
        `).run(userId, chosenUsername, wallet.address, encryptedSeed)
        
        await db.prepare(`
          INSERT INTO payment_links (user_id, slug) VALUES (?, ?)
        `).run(userId, chosenUsername)
        
        const tipUrl = `${BASE_URL}/${chosenUsername}`
        
        userState.delete(userId)
        
        await bot.sendMessage(chatId,
          `✅ <b>Wallet Created!</b>\n\n` +
          `👤 Username: <b>${chosenUsername}</b>\n` +
          `💳 Address:\n<code>${wallet.address}</code>\n\n` +
          `🔗 Your tip link:\n<a href="${tipUrl}">${tipUrl}</a>\n\n` +
          `⚠️ <i>This is a testnet wallet. Get test KTA from the faucet.</i>`,
          { parse_mode: 'HTML', reply_markup: mainMenu }
        )
        return
      }
      
      // Handle username change for existing users
      if (state.step === 'set_username') {
        const newUsername = msg.text?.trim().toLowerCase()
        const userId = msg.from.id
        
        if (!newUsername || newUsername.length < 3 || newUsername.length > 15) {
          await bot.sendMessage(chatId, '❌ Username must be 3-15 characters. Try again:')
          return
        }
        
        if (!/^[a-z0-9]+$/.test(newUsername)) {
          await bot.sendMessage(chatId, '❌ Only letters (a-z) and numbers (0-9) allowed. Try again:')
          return
        }
        
        const existingUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ? AND telegram_id != ?').get(newUsername, userId)
        const existingLink = await db.prepare('SELECT * FROM payment_links WHERE slug = ? AND user_id != ?').get(newUsername, userId)
        
        if (existingUser || existingLink) {
          await bot.sendMessage(chatId, `❌ Username "${newUsername}" is already taken. Try another:`)
          return
        }
        
        await db.prepare('UPDATE users SET username = ? WHERE telegram_id = ?').run(newUsername, userId)
        await db.prepare('UPDATE payment_links SET slug = ? WHERE user_id = ?').run(newUsername, userId)
        
        userState.delete(userId)
        
        const tipUrl = `${BASE_URL}/${newUsername}`
        await bot.sendMessage(chatId,
          `✅ Username changed to <b>${newUsername}</b>!\n\n` +
          `🔗 New tip link: <a href="${tipUrl}">${tipUrl}</a>`,
          { parse_mode: 'HTML', reply_markup: mainMenu }
        )
        return
      }
      
      const user = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      if (!user) return

      // Send flow - address
      if (state.step === 'send_address') {
        const input = msg.text?.trim()

        let toAddress = null
        let toUser = null

        // Check if it's a @username
        if (input.startsWith('@')) {
          const targetUsername = input.slice(1).toLowerCase()
          toUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(targetUsername)
          
          if (toUser) {
            toAddress = toUser.keeta_address
          } else {
            await bot.sendMessage(chatId, '❌ User not found. They need to /start the bot first.\n\nOr enter a Keeta address:')
            return
          }
        } else if (keeta.isValidAddress(input)) {
          toAddress = input
        } else {
          await bot.sendMessage(chatId, '❌ Invalid address or username. Try again:')
          return
        }

        state.toAddress = toAddress
        state.toUser = toUser
        state.step = 'send_amount'
        userState.set(userId, state)

        await bot.sendMessage(chatId, '💰 Enter amount to send:')
        return
      }

      // Send flow - amount
      if (state.step === 'send_amount') {
        const amount = parseFloat(msg.text?.trim())

        if (isNaN(amount) || amount <= 0) {
          await bot.sendMessage(chatId, '❌ Invalid amount. Enter a positive number:')
          return
        }

        await bot.sendMessage(chatId, '⏳ Sending...')

        try {
          const seed = decryptSeed(user.encrypted_seed, userId.toString())
          const result = await keeta.sendTokens(seed, state.toAddress, amount)

          if (result.success) {
            // Record the tip if it was to a known user
            if (state.toUser) {
              await db.prepare(`
                INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
                VALUES (?, ?, ?, ?)
              `).run(userId, state.toUser.telegram_id, amount.toString(), result.txHash)

              // Notify recipient
              try {
                await bot.sendMessage(state.toUser.telegram_id,
                  `💸 <b>You received a tip!</b>\n\n` +
                  `From: @${user.username}\n` +
                  `Amount: ${amount} KTA\n\n` +
                  `TX: <code>${result.txHash}</code>`,
                  { parse_mode: 'HTML' }
                )
              } catch (e) {
                // User might have blocked the bot
              }
            }

            await bot.sendMessage(chatId,
              `✅ <b>Sent!</b>\n\n` +
              `Amount: ${amount} KTA\n` +
              `To: <code>${state.toAddress.slice(0, 15)}...</code>\n` +
              `TX: <code>${result.txHash}</code>`,
              { parse_mode: 'HTML', reply_markup: mainMenu }
            )
          } else {
            await bot.sendMessage(chatId,
              `❌ <b>Failed</b>\n\n${result.error}`,
              { parse_mode: 'HTML', reply_markup: mainMenu }
            )
          }
        } catch (e) {
          console.error('Send error:', e)
          await bot.sendMessage(chatId, '❌ Error sending. Check your balance.', { reply_markup: mainMenu })
        }

        userState.delete(userId)
        return
      }

      // Tip flow - @user amount
      if (state.step === 'tip_user') {
        const match = msg.text?.match(/@(\w+)\s+([\d.]+)/)

        if (!match) {
          await bot.sendMessage(chatId, '❌ Invalid format. Use: <code>@username amount</code>', { parse_mode: 'HTML' })
          return
        }

        const [, targetUsername, amountStr] = match
        const amount = parseFloat(amountStr)

        if (isNaN(amount) || amount <= 0) {
          await bot.sendMessage(chatId, '❌ Invalid amount.')
          return
        }

        const toUser = await db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(targetUsername.toLowerCase())

        if (!toUser) {
          await bot.sendMessage(chatId, '❌ User not found. They need to /start the bot first.', { reply_markup: mainMenu })
          userState.delete(userId)
          return
        }

        await bot.sendMessage(chatId, `⏳ Tipping @${targetUsername} ${amount} KTA...`)

        try {
          const seed = decryptSeed(user.encrypted_seed, userId.toString())
          const result = await keeta.sendTokens(seed, toUser.keeta_address, amount)

          if (result.success) {
            await db.prepare(`
              INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
              VALUES (?, ?, ?, ?)
            `).run(userId, toUser.telegram_id, amount.toString(), result.txHash)

            // Notify recipient
            try {
              await bot.sendMessage(toUser.telegram_id,
                `💸 <b>You received a tip!</b>\n\n` +
                `From: @${user.username}\n` +
                `Amount: ${amount} KTA`,
                { parse_mode: 'HTML' }
              )
            } catch (e) { }

            await bot.sendMessage(chatId,
              `✅ <b>Tipped @${targetUsername}!</b>\n\n` +
              `Amount: ${amount} KTA`,
              { parse_mode: 'HTML', reply_markup: mainMenu }
            )
          } else {
            await bot.sendMessage(chatId, `❌ Failed: ${result.error}`, { reply_markup: mainMenu })
          }
        } catch (e) {
          console.error('Tip error:', e)
          await bot.sendMessage(chatId, '❌ Error tipping.', { reply_markup: mainMenu })
        }

        userState.delete(userId)
        return
      }
    } catch (e) {
      console.error('Message error:', e)
    }
  })

  // Inline tip in group chats: reply with "$tip 5" 
  bot.onText(/\$tip\s+([\d.]+)/i, async (msg, match) => {
    if (!msg.reply_to_message) return // Must be a reply

    const chatId = msg.chat.id
    const userId = msg.from.id
    const amount = parseFloat(match[1])

    if (isNaN(amount) || amount <= 0) return

    try {
      const fromUser = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      if (!fromUser) {
        await bot.sendMessage(chatId, '❌ You need to /start @KeetaTipBot first to tip!', { reply_to_message_id: msg.message_id })
        return
      }

      const toUserId = msg.reply_to_message.from.id
      const toUser = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(toUserId)

      if (!toUser) {
        await bot.sendMessage(chatId, `❌ @${msg.reply_to_message.from.username || 'User'} needs to /start @KeetaTipBot first!`, { reply_to_message_id: msg.message_id })
        return
      }

      if (userId === toUserId) {
        await bot.sendMessage(chatId, '❌ You can\'t tip yourself!', { reply_to_message_id: msg.message_id })
        return
      }

      const seed = decryptSeed(fromUser.encrypted_seed, userId.toString())
      const result = await keeta.sendTokens(seed, toUser.keeta_address, amount)

      if (result.success) {
        await db.prepare(`
          INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
          VALUES (?, ?, ?, ?)
        `).run(userId, toUserId, amount.toString(), result.txHash)

        await bot.sendMessage(chatId,
          `💸 @${fromUser.username} tipped @${toUser.username} <b>${amount} KTA</b>!`,
          { parse_mode: 'HTML', reply_to_message_id: msg.reply_to_message.message_id }
        )

        // DM the recipient
        try {
          await bot.sendMessage(toUserId,
            `💸 <b>You received a tip!</b>\n\n` +
            `From: @${fromUser.username}\n` +
            `Amount: ${amount} KTA`,
            { parse_mode: 'HTML' }
          )
        } catch (e) { }
      } else {
        await bot.sendMessage(chatId, `❌ Tip failed: ${result.error}`, { reply_to_message_id: msg.message_id })
      }
    } catch (e) {
      console.error('Inline tip error:', e)
      await bot.sendMessage(chatId, '❌ Tip failed. Check your balance.', { reply_to_message_id: msg.message_id })
    }
  })

  console.log('🤖 KeetaTip bot started!')
}

start().catch(console.error)
