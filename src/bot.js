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
    const username = msg.from.username || msg.from.first_name

    console.log(`👋 /start from ${username} (${userId})`)

    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)

    if (!user) {
      // Create new wallet
      await bot.sendMessage(chatId, '🔐 Creating your Keeta wallet...')

      try {
        const wallet = keeta.createWallet()
        const encryptedSeed = encryptSeed(wallet.seed, userId.toString())

        db.prepare(`
          INSERT INTO users (telegram_id, username, keeta_address, encrypted_seed)
          VALUES (?, ?, ?, ?)
        `).run(userId, username, wallet.address, encryptedSeed)

        // Create default payment link
        const slug = username?.toLowerCase().replace(/[^a-z0-9]/g, '') || `user${userId}`
        try {
          db.prepare(`
            INSERT INTO payment_links (user_id, slug) VALUES (?, ?)
          `).run(userId, slug)
        } catch (e) {
          // Slug might already exist, add random suffix
          db.prepare(`
            INSERT INTO payment_links (user_id, slug) VALUES (?, ?)
          `).run(userId, `${slug}${Math.floor(Math.random() * 1000)}`)
        }

        await bot.sendMessage(chatId,
          `✅ *Wallet Created!*\n\n` +
          `💳 Your address:\n\`${wallet.address}\`\n\n` +
          `🔗 Your tip link:\n${BASE_URL}/${slug}\n\n` +
          `⚠️ _This is a testnet wallet. Get test KTA from the faucet._`,
          { parse_mode: 'Markdown' }
        )

        user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
      } catch (e) {
        console.error('Wallet creation error:', e)
        await bot.sendMessage(chatId, '❌ Error creating wallet. Please try again.')
        return
      }
    }

    await bot.sendMessage(chatId,
      `🎉 *KeetaTip*\n\n` +
      `Welcome back! Tip anyone with KTA.\n\n` +
      `💳 \`${user.keeta_address}\``,
      { parse_mode: 'Markdown', reply_markup: mainMenu }
    )
  })

  // Handle button presses
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id
    const userId = query.from.id
    const data = query.data

    await bot.answerCallbackQuery(query.id)

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
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

        let text = '💰 *Your Balance*\n\n'
        if (typeof balance === 'object') {
          for (const [token, amount] of Object.entries(balance)) {
            text += `• ${token}: ${amount}\n`
          }
        } else {
          text += `• KTA: ${balance}\n`
        }

        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: mainMenu })
      } catch (e) {
        console.error('Balance error:', e)
        await bot.sendMessage(chatId, '❌ Error fetching balance.', { reply_markup: mainMenu })
      }
      return
    }

    // Receive
    if (data === 'receive') {
      await bot.sendMessage(chatId,
        `📥 *Receive KTA*\n\n` +
        `Your address:\n\`${user.keeta_address}\`\n\n` +
        `Share this address to receive KTA.\n\n` +
        `🔗 Or share your tip link:\n${BASE_URL}/${user.username?.toLowerCase() || 'user' + userId}`,
        { parse_mode: 'Markdown', reply_markup: mainMenu }
      )
      return
    }

    // My Link
    if (data === 'mylink') {
      const link = db.prepare('SELECT * FROM payment_links WHERE user_id = ? AND is_active = 1').get(userId)
      
      if (link) {
        await bot.sendMessage(chatId,
          `🔗 *Your Payment Link*\n\n` +
          `${BASE_URL}/${link.slug}\n\n` +
          `Share this link to receive tips!`,
          { parse_mode: 'Markdown', reply_markup: mainMenu }
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
        '📤 *Send KTA*\n\n' +
        'Enter the recipient address or @username:',
        { parse_mode: 'Markdown' }
      )
      return
    }

    // Tip - same as send but for @mentions
    if (data === 'tip') {
      userState.set(userId, { step: 'tip_user' })
      await bot.sendMessage(chatId,
        '💸 *Tip a User*\n\n' +
        'Enter @username and amount:\n' +
        'Example: `@john 5`',
        { parse_mode: 'Markdown' }
      )
      return
    }

    // History
    if (data === 'history') {
      const tips = db.prepare(`
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

      let text = '📜 *Recent Transactions*\n\n'
      for (const tip of tips) {
        const direction = tip.from_user_id === userId ? '📤' : '📥'
        const other = tip.from_user_id === userId ? tip.to_user : tip.from_user
        text += `${direction} ${tip.amount} ${tip.token} ${tip.from_user_id === userId ? 'to' : 'from'} @${other}\n`
      }

      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: mainMenu })
      return
    }

    // Leaderboard
    if (data === 'leaderboard') {
      const topTippers = db.prepare(`
        SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
        FROM tips t
        JOIN users u ON t.from_user_id = u.telegram_id
        GROUP BY t.from_user_id
        ORDER BY total DESC
        LIMIT 10
      `).all()

      const topReceivers = db.prepare(`
        SELECT u.username, SUM(CAST(t.amount AS REAL)) as total
        FROM tips t
        JOIN users u ON t.to_user_id = u.telegram_id
        GROUP BY t.to_user_id
        ORDER BY total DESC
        LIMIT 10
      `).all()

      let text = '🏆 *Leaderboard*\n\n'
      
      text += '*Top Tippers:*\n'
      if (topTippers.length === 0) {
        text += '_No tips yet_\n'
      } else {
        topTippers.forEach((t, i) => {
          text += `${i + 1}. @${t.username} - ${t.total} KTA\n`
        })
      }

      text += '\n*Top Receivers:*\n'
      if (topReceivers.length === 0) {
        text += '_No tips yet_\n'
      } else {
        topReceivers.forEach((r, i) => {
          text += `${i + 1}. @${r.username} - ${r.total} KTA\n`
        })
      }

      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: mainMenu })
      return
    }
  })

  // Handle text messages (for flows)
  bot.on('message', async (msg) => {
    if (msg.text?.startsWith('/')) return

    const userId = msg.from.id
    const chatId = msg.chat.id
    const state = userState.get(userId)

    if (!state) return

    const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!user) return

    // Send flow - address
    if (state.step === 'send_address') {
      const input = msg.text?.trim()

      let toAddress = null
      let toUser = null

      // Check if it's a @username
      if (input.startsWith('@')) {
        const targetUsername = input.slice(1).toLowerCase()
        toUser = db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(targetUsername)
        
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
            db.prepare(`
              INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
              VALUES (?, ?, ?, ?)
            `).run(userId, state.toUser.telegram_id, amount.toString(), result.txHash)

            // Notify recipient
            try {
              await bot.sendMessage(state.toUser.telegram_id,
                `💸 *You received a tip!*\n\n` +
                `From: @${user.username}\n` +
                `Amount: ${amount} KTA\n\n` +
                `TX: \`${result.txHash}\``,
                { parse_mode: 'Markdown' }
              )
            } catch (e) {
              // User might have blocked the bot
            }
          }

          await bot.sendMessage(chatId,
            `✅ *Sent!*\n\n` +
            `Amount: ${amount} KTA\n` +
            `To: \`${state.toAddress.slice(0, 15)}...\`\n` +
            `TX: \`${result.txHash}\``,
            { parse_mode: 'Markdown', reply_markup: mainMenu }
          )
        } else {
          await bot.sendMessage(chatId,
            `❌ *Failed*\n\n${result.error}`,
            { parse_mode: 'Markdown', reply_markup: mainMenu }
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
        await bot.sendMessage(chatId, '❌ Invalid format. Use: `@username amount`', { parse_mode: 'Markdown' })
        return
      }

      const [, targetUsername, amountStr] = match
      const amount = parseFloat(amountStr)

      if (isNaN(amount) || amount <= 0) {
        await bot.sendMessage(chatId, '❌ Invalid amount.')
        return
      }

      const toUser = db.prepare('SELECT * FROM users WHERE LOWER(username) = ?').get(targetUsername.toLowerCase())

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
          db.prepare(`
            INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
            VALUES (?, ?, ?, ?)
          `).run(userId, toUser.telegram_id, amount.toString(), result.txHash)

          // Notify recipient
          try {
            await bot.sendMessage(toUser.telegram_id,
              `💸 *You received a tip!*\n\n` +
              `From: @${user.username}\n` +
              `Amount: ${amount} KTA`,
              { parse_mode: 'Markdown' }
            )
          } catch (e) { }

          await bot.sendMessage(chatId,
            `✅ *Tipped @${targetUsername}!*\n\n` +
            `Amount: ${amount} KTA`,
            { parse_mode: 'Markdown', reply_markup: mainMenu }
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
  })

  // Inline tip in group chats: reply with "$tip 5" 
  bot.onText(/\$tip\s+([\d.]+)/i, async (msg, match) => {
    if (!msg.reply_to_message) return // Must be a reply

    const chatId = msg.chat.id
    const userId = msg.from.id
    const amount = parseFloat(match[1])

    if (isNaN(amount) || amount <= 0) return

    const fromUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(userId)
    if (!fromUser) {
      await bot.sendMessage(chatId, '❌ You need to /start @KeetaTipBot first to tip!', { reply_to_message_id: msg.message_id })
      return
    }

    const toUserId = msg.reply_to_message.from.id
    const toUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(toUserId)

    if (!toUser) {
      await bot.sendMessage(chatId, `❌ @${msg.reply_to_message.from.username || 'User'} needs to /start @KeetaTipBot first!`, { reply_to_message_id: msg.message_id })
      return
    }

    if (userId === toUserId) {
      await bot.sendMessage(chatId, '❌ You can\'t tip yourself!', { reply_to_message_id: msg.message_id })
      return
    }

    try {
      const seed = decryptSeed(fromUser.encrypted_seed, userId.toString())
      const result = await keeta.sendTokens(seed, toUser.keeta_address, amount)

      if (result.success) {
        db.prepare(`
          INSERT INTO tips (from_user_id, to_user_id, amount, tx_hash)
          VALUES (?, ?, ?, ?)
        `).run(userId, toUserId, amount.toString(), result.txHash)

        await bot.sendMessage(chatId,
          `💸 @${fromUser.username} tipped @${toUser.username} *${amount} KTA*!`,
          { parse_mode: 'Markdown', reply_to_message_id: msg.reply_to_message.message_id }
        )

        // DM the recipient
        try {
          await bot.sendMessage(toUserId,
            `💸 *You received a tip!*\n\n` +
            `From: @${fromUser.username}\n` +
            `Amount: ${amount} KTA`,
            { parse_mode: 'Markdown' }
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
