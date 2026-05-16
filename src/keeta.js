/**
 * Keeta Network SDK integration
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const KeetaNet = require('@keetanetwork/keetanet-client')
const crypto = require('crypto')

const NETWORK = process.env.KEETA_NETWORK || 'test'

/**
 * Generate a new wallet (seed + address)
 */
function createWallet() {
  // Generate random 32-byte seed (64 hex chars) - must be lowercase
  const seed = crypto.randomBytes(32).toString('hex')
  console.log('Generated seed')
  
  // Create account from seed
  const account = KeetaNet.lib.Account.fromSeed(seed, 0)
  console.log('Created account')
  
  const address = account.publicKeyString.get()
  console.log('Got address:', address)
  
  return {
    seed: seed,
    address: address
  }
}

/**
 * Get account from seed
 */
function getAccount(seedString) {
  return KeetaNet.lib.Account.fromSeed(seedString, 0)
}

/**
 * Get UserClient for an account
 */
function getClient(account) {
  return KeetaNet.UserClient.fromNetwork(NETWORK, account)
}

/**
 * Get balance for an account
 */
async function getBalance(seedString) {
  try {
    const account = getAccount(seedString)
    const client = getClient(account)
    
    const state = await client.state()
    
    // Parse balances from state - use KTA as the display name
    const balances = {}
    if (state && state.balances) {
      for (const [token, amount] of Object.entries(state.balances)) {
        // Handle BigInt, object with value, or primitive
        let amountStr = '0'
        if (typeof amount === 'bigint') {
          amountStr = (Number(amount) / 1e8).toFixed(8)
        } else if (typeof amount === 'object' && amount !== null) {
          const val = amount.value || amount.amount || amount.balance || amount
          amountStr = (Number(val) / 1e8).toFixed(8)
        } else {
          amountStr = (Number(amount) / 1e8).toFixed(8)
        }
        // Use KTA as display name, remove trailing zeros
        balances['KTA'] = parseFloat(amountStr).toString()
      }
    }
    
    // Default to showing KTA
    if (Object.keys(balances).length === 0) {
      balances['KTA'] = '0'
    }
    
    return balances
  } catch (e) {
    console.error('Error getting balance:', e)
    return { 'KTA': '0' }
  }
}

/**
 * Send tokens
 */
async function sendTokens(fromSeed, toAddress, amount) {
  try {
    const fromAccount = getAccount(fromSeed)
    const client = getClient(fromAccount)
    
    // Create recipient account from address
    const toAccount = KeetaNet.lib.Account.fromPublicKeyString(toAddress)
    
    // Create builder and add send operation
    const builder = client.initBuilder()
    builder.send(toAccount, BigInt(Math.floor(amount * 1e8)), client.baseToken) // Convert to smallest unit
    
    // Publish transaction
    const result = await client.publishBuilder(builder)
    
    return {
      success: true,
      txHash: result?.hash || 'pending',
      amount,
      to: toAddress
    }
  } catch (e) {
    console.error('Error sending tokens:', e)
    return {
      success: false,
      error: e.message || 'Transaction failed'
    }
  }
}

/**
 * Get transaction history
 */
async function getTransactions(seedString, limit = 10) {
  try {
    const account = getAccount(seedString)
    const client = getClient(account)
    
    const history = await client.history()
    return history?.slice(0, limit) || []
  } catch (e) {
    console.error('Error getting transactions:', e)
    return []
  }
}

/**
 * Validate Keeta address
 */
function isValidAddress(address) {
  if (!address || typeof address !== 'string') return false
  if (!address.startsWith('keeta_')) return false
  if (address.length < 50) return false
  
  try {
    KeetaNet.lib.Account.fromPublicKeyString(address)
    return true
  } catch {
    return false
  }
}

/**
 * Get address from seed
 */
function getAddress(seedString) {
  const account = getAccount(seedString)
  return account.publicKeyString.get()
}

module.exports = {
  createWallet,
  getAccount,
  getClient,
  getBalance,
  sendTokens,
  getTransactions,
  isValidAddress,
  getAddress
}
