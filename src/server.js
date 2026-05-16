/**
 * KeetaTip Web Server - Payment Links
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const express = require('express')
const path = require('path')
const { initDb } = require('./db')
const db = require('./db')
const keeta = require('./keeta')

const PORT = process.env.PORT || 3000
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`

const app = express()
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static(path.join(__dirname, 'public')))

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// API: Get user by slug
app.get('/api/user/:slug', async (req, res) => {
  const { slug } = req.params

  try {
    const link = await db.prepare(`
      SELECT pl.*, u.username, u.keeta_address
      FROM payment_links pl
      JOIN users u ON pl.user_id = u.telegram_id
      WHERE pl.slug = ? AND pl.is_active = 1
    `).get(slug)

    if (!link) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      username: link.username,
      address: link.keeta_address,
      slug: link.slug,
      defaultAmount: link.default_amount,
      description: link.description
    })
  } catch (e) {
    console.error('API error:', e)
    res.status(500).json({ error: 'Server error' })
  }
})

// API: Get recent payments for a link
app.get('/api/payments/:slug', async (req, res) => {
  const { slug } = req.params

  try {
    const link = await db.prepare('SELECT * FROM payment_links WHERE slug = ?').get(slug)
    if (!link) {
      return res.status(404).json({ error: 'Link not found' })
    }

    const payments = await db.prepare(`
      SELECT * FROM payments
      WHERE link_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(link.id)

    res.json(payments)
  } catch (e) {
    console.error('API error:', e)
    res.status(500).json({ error: 'Server error' })
  }
})

// Payment link page
app.get('/:slug', async (req, res) => {
  const { slug } = req.params
  
  console.log(`[PAGE] Request for slug: ${slug}`)

  try {
    // First check if slug exists at all
    const linkOnly = await db.prepare('SELECT * FROM payment_links WHERE slug = ?').get(slug)
    console.log(`[PAGE] Link found:`, linkOnly)
    
    if (linkOnly) {
      const userOnly = await db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(linkOnly.user_id)
      console.log(`[PAGE] User found:`, userOnly)
    }
    
    const link = await db.prepare(`
      SELECT pl.*, u.username, u.keeta_address
      FROM payment_links pl
      JOIN users u ON pl.user_id = u.telegram_id
      WHERE pl.slug = ? AND pl.is_active = 1
    `).get(slug)
    
    console.log(`[PAGE] JOIN result:`, link)

  if (!link) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Found - KeetaTip</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui; text-align: center; padding: 50px; background: #1a1a2e; color: white; }
          h1 { font-size: 48px; }
        </style>
      </head>
      <body>
        <h1>404</h1>
        <p>User not found</p>
        <a href="/" style="color: #7b68ee;">Go home</a>
      </body>
      </html>
    `)
  }

  // Generate tip page HTML
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tip @${link.username} - KeetaTip</title>
  <meta name="description" content="Send a tip to @${link.username} with KTA on Keeta Network">
  <meta property="og:title" content="Tip @${link.username}">
  <meta property="og:description" content="Send KTA tips instantly">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: white;
    }
    .card {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #7b68ee, #9b59b6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin: 0 auto 20px;
    }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .username { color: #7b68ee; font-size: 18px; margin-bottom: 30px; }
    .amount-buttons {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .amount-btn {
      padding: 15px;
      border: 2px solid rgba(255,255,255,0.2);
      border-radius: 12px;
      background: transparent;
      color: white;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .amount-btn:hover, .amount-btn.active {
      border-color: #7b68ee;
      background: rgba(123,104,238,0.2);
    }
    .custom-amount {
      width: 100%;
      padding: 15px;
      border: 2px solid rgba(255,255,255,0.2);
      border-radius: 12px;
      background: transparent;
      color: white;
      font-size: 18px;
      text-align: center;
      margin-bottom: 20px;
    }
    .custom-amount:focus {
      outline: none;
      border-color: #7b68ee;
    }
    .address-box {
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 15px;
      margin-bottom: 20px;
      word-break: break-all;
      font-family: monospace;
      font-size: 12px;
    }
    .copy-btn {
      background: #7b68ee;
      border: none;
      color: white;
      padding: 15px 30px;
      border-radius: 12px;
      font-size: 16px;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    .copy-btn:hover { background: #6c5ce7; }
    .powered {
      margin-top: 30px;
      font-size: 12px;
      color: rgba(255,255,255,0.5);
    }
    .powered a { color: #7b68ee; text-decoration: none; }
    .qr-code {
      margin: 20px auto;
      padding: 15px;
      background: white;
      border-radius: 12px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">${link.username?.charAt(0).toUpperCase() || '?'}</div>
    <h1>Send a Tip</h1>
    <p class="username">@${link.username}</p>

    <div class="amount-buttons">
      <button class="amount-btn" data-amount="1">1 KTA</button>
      <button class="amount-btn" data-amount="5">5 KTA</button>
      <button class="amount-btn" data-amount="10">10 KTA</button>
      <button class="amount-btn" data-amount="25">25 KTA</button>
      <button class="amount-btn" data-amount="50">50 KTA</button>
      <button class="amount-btn" data-amount="100">100 KTA</button>
    </div>

    <input type="number" class="custom-amount" placeholder="Or enter custom amount" id="customAmount">

    <div class="address-box" id="address">${link.keeta_address}</div>

    <button class="copy-btn" id="copyBtn">📋 Copy Address</button>

    <div class="powered">
      Powered by <a href="https://keeta.com" target="_blank">Keeta Network</a>
    </div>
  </div>

  <script>
    const address = '${link.keeta_address}';
    
    // Amount buttons
    document.querySelectorAll('.amount-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('customAmount').value = btn.dataset.amount;
      });
    });

    // Copy address
    document.getElementById('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(address);
        document.getElementById('copyBtn').textContent = '✅ Copied!';
        setTimeout(() => {
          document.getElementById('copyBtn').textContent = '📋 Copy Address';
        }, 2000);
      } catch (e) {
        alert('Address: ' + address);
      }
    });
  </script>
</body>
</html>
  `

    res.send(html)
  } catch (e) {
    console.error('Payment page error:', e)
    res.status(500).send('Server error')
  }
})

// Home page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>KeetaTip - Tip Anyone with KTA</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: white;
    }
    .container {
      text-align: center;
      max-width: 600px;
    }
    h1 {
      font-size: 48px;
      margin-bottom: 20px;
      background: linear-gradient(135deg, #7b68ee, #9b59b6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      font-size: 20px;
      color: rgba(255,255,255,0.8);
      margin-bottom: 40px;
    }
    .cta {
      display: inline-block;
      background: #7b68ee;
      color: white;
      padding: 15px 40px;
      border-radius: 30px;
      text-decoration: none;
      font-size: 18px;
      transition: transform 0.2s;
    }
    .cta:hover { transform: scale(1.05); }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 20px;
      margin-top: 60px;
    }
    .feature {
      background: rgba(255,255,255,0.1);
      padding: 20px;
      border-radius: 12px;
    }
    .feature h3 { margin-bottom: 10px; }
    .feature p { font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>💸 KeetaTip</h1>
    <p>Tip anyone instantly with KTA on Keeta Network</p>
    <a href="https://t.me/KeetaTipBot" class="cta">Start on Telegram →</a>

    <div class="features">
      <div class="feature">
        <h3>💬 In-Chat Tips</h3>
        <p>Tip users directly in Telegram groups</p>
      </div>
      <div class="feature">
        <h3>🔗 Payment Links</h3>
        <p>Share your personal tip link anywhere</p>
      </div>
      <div class="feature">
        <h3>⚡ Instant</h3>
        <p>Tips arrive in seconds</p>
      </div>
    </div>
  </div>
</body>
</html>
  `)
})

async function startServer() {
  await initDb()
  
  app.listen(PORT, () => {
    console.log(`🌐 KeetaTip server running on ${BASE_URL}`)
  })
}

module.exports = { app, startServer }

// Start if run directly
if (require.main === module) {
  startServer()
}
