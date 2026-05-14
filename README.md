# KeetaTip 💸

**Tip anyone with KTA on Keeta Network** - Telegram Bot + Payment Links

Built for the [KeetaLand Contest](https://keetaland.xyz/contest)

## Features

### 🤖 Telegram Bot
- Create wallet instantly with `/start`
- Check balance, send/receive KTA
- Tip users with `@username amount` or reply with `$tip 5`
- Transaction history & leaderboard

### 🔗 Payment Links
- Personal tip page: `keetatip.xyz/yourname`
- Share anywhere to receive tips
- Quick amount buttons
- Copy address to clipboard

### ⚡ Highlights
- **Instant** - Tips arrive in seconds
- **Non-custodial** - You control your keys
- **Testnet** - Get test KTA from faucet
- **Open Source** - Built with Keeta SDK

## Tech Stack

- **Bot**: Node.js + node-telegram-bot-api
- **Web**: Express.js
- **SDK**: @keetanetwork/keetanet-client
- **Database**: SQLite (sql.js)

## Quick Start

```bash
# Clone
git clone https://github.com/Vibeaman/keetatip.git
cd keetatip

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your bot token

# Run
npm start
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOT_TOKEN` | Telegram bot token from @BotFather |
| `ENCRYPTION_KEY` | 32-byte hex key for wallet encryption |
| `KEETA_NETWORK` | `test` or `main` |
| `PORT` | Web server port (default: 3000) |
| `BASE_URL` | Public URL for payment links |

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Create wallet & see menu |
| `/balance` | Check your balance |
| `/send` | Send KTA to address or @user |
| `/tip @user 5` | Tip a user |
| `$tip 5` | Reply to tip (in groups) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /:slug` | Payment link page |
| `GET /api/user/:slug` | Get user info |
| `GET /health` | Health check |

## License

MIT

## Author

Built by [Vibeaman](https://github.com/Vibeaman) for KeetaLand Contest 2026
