import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'

type Bindings = {
  DB?: any // D1Database
  NODE_ENV?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// In-Memory state for local dev and SSE event broadcasting
type SSEClient = {
  id: string
  userId: string
  write: (data: string) => void
}

const sseClients = new Set<SSEClient>()

function broadcastSSE(event: string, payload: any) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(data)
    } catch {
      sseClients.delete(client)
    }
  }
}

// In-memory fallback database for local dev / when D1 is not attached
interface Profile {
  id: string
  userId: string
  username: string
  displayName: string
  role: string
  createdAt: string
}

interface Conversation {
  id: string
  userAId: string
  userBId: string
  status: string
  createdAt: string
  updatedAt: string
}

interface Message {
  id: string
  conversationId: string
  senderId: string
  body: string
  readAt: string | null
  createdAt: string
}

const memDb = {
  settings: new Map<string, string>(),
  profiles: new Map<string, Profile>(),
  conversations: new Map<string, Conversation>(),
  messages: [] as Message[],
  sessions: new Map<string, { userId: string; username: string; displayName: string }>(),
}

// Seed default shop profile if empty
function ensureSeed() {
  if (memDb.profiles.size === 0) {
    const admin: Profile = {
      id: 'admin_1',
      userId: 'admin_1',
      username: 'kathmandu_store',
      displayName: 'New Road Electronics 🇳🇵',
      role: 'admin',
      createdAt: new Date().toISOString(),
    }
    const customer: Profile = {
      id: 'cust_1',
      userId: 'cust_1',
      username: 'aarav_shrestha',
      displayName: 'Aarav Shrestha (Patan)',
      role: 'customer',
      createdAt: new Date().toISOString(),
    }
    memDb.profiles.set(admin.id, admin)
    memDb.profiles.set(customer.id, customer)

    const conv: Conversation = {
      id: 'conv_1',
      userAId: admin.id,
      userBId: customer.id,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    memDb.conversations.set(conv.id, conv)

    memDb.messages.push({
      id: 'msg_1',
      conversationId: conv.id,
      senderId: customer.id,
      body: 'Namaste! Do you have the Sony WH-1000XM5 headphones in stock?',
      readAt: new Date().toISOString(),
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    })
    memDb.messages.push({
      id: 'msg_2',
      conversationId: conv.id,
      senderId: admin.id,
      body: 'Namaste Aarav! Yes, in stock. Same day delivery inside Valley available!',
      readAt: null,
      createdAt: new Date(Date.now() - 1800000).toISOString(),
    })
    memDb.settings.set('businessName', 'New Road Electronics')
    memDb.settings.set('isSetup', 'true')
  }
}
ensureSeed()

// Helper: Ensure D1 tables exist
let d1Migrated = false
async function ensureD1Tables(db: any) {
  if (d1Migrated || !db) return
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        userId TEXT UNIQUE,
        username TEXT UNIQUE,
        displayName TEXT,
        role TEXT DEFAULT 'user',
        createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        userAId TEXT,
        userBId TEXT,
        status TEXT DEFAULT 'active',
        createdAt TEXT,
        updatedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT,
        senderId TEXT,
        body TEXT,
        readAt TEXT,
        createdAt TEXT
      );
      CREATE TABLE IF NOT EXISTS federation_friendships (
        id TEXT PRIMARY KEY,
        localUserId TEXT,
        remoteUsername TEXT,
        status TEXT DEFAULT 'active',
        createdAt TEXT
      );
    `)
    d1Migrated = true
  } catch (err: any) {
    console.warn('[D1 Setup Warning]', err?.message)
  }
}

// 1. Setup Status & Wizard
app.get('/api/setup/status', async (c) => {
  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'isSetup'").first()
    const bName = await db.prepare("SELECT value FROM settings WHERE key = 'businessName'").first()
    return c.json({
      setupRequired: !row || row.value !== 'true',
      businessName: bName?.value || 'Chatze Nepal Store',
    })
  }

  const isSetup = memDb.settings.get('isSetup') === 'true'
  return c.json({
    setupRequired: !isSetup,
    businessName: memDb.settings.get('businessName') || 'Chatze Nepal Store',
  })
})

app.post('/api/setup', async (c) => {
  const { businessName, adminUsername, password } = await c.req.json()
  const db = c.env?.DB

  if (db) {
    await ensureD1Tables(db)
    const adminId = 'admin_' + Math.random().toString(36).slice(2, 9)
    await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('isSetup', 'true'), ('businessName', ?)").bind(businessName).run()
    await db.prepare("INSERT OR REPLACE INTO profiles (id, userId, username, displayName, role, createdAt) VALUES (?, ?, ?, ?, 'admin', ?)")
      .bind(adminId, adminId, adminUsername, businessName, new Date().toISOString()).run()
    return c.json({ success: true, adminId, username: adminUsername })
  }

  memDb.settings.set('isSetup', 'true')
  memDb.settings.set('businessName', businessName || 'My Shop')
  const adminId = 'admin_' + Date.now()
  const prof: Profile = {
    id: adminId,
    userId: adminId,
    username: adminUsername || 'admin',
    displayName: businessName || 'Shop Admin',
    role: 'admin',
    createdAt: new Date().toISOString(),
  }
  memDb.profiles.set(adminId, prof)
  return c.json({ success: true, adminId, username: prof.username })
})

// 2. Auth Endpoints
app.get('/api/auth/session', async (c) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '') || 'default_session'
  
  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const firstAdmin = await db.prepare("SELECT * FROM profiles WHERE role = 'admin' LIMIT 1").first()
    if (firstAdmin) {
      return c.json({ user: firstAdmin })
    }
  }

  const defaultAdmin = Array.from(memDb.profiles.values()).find((p) => p.role === 'admin') || Array.from(memDb.profiles.values())[0]
  if (defaultAdmin) {
    return c.json({ user: defaultAdmin })
  }
  return c.json({ user: null }, 401)
})

app.post('/api/auth/sign-in', async (c) => {
  const { username, password } = await c.req.json()
  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const row = await db.prepare('SELECT * FROM profiles WHERE username = ?').bind(username).first()
    if (row) return c.json({ success: true, user: row })
  }

  const profile = Array.from(memDb.profiles.values()).find((p) => p.username === username)
  if (profile) return c.json({ success: true, user: profile })
  return c.json({ error: 'User not found' }, 404)
})

app.post('/api/auth/sign-up', async (c) => {
  const { username, displayName, password } = await c.req.json()
  const id = 'user_' + Math.random().toString(36).slice(2, 9)
  const profile: Profile = {
    id,
    userId: id,
    username: username || 'user_' + Date.now(),
    displayName: displayName || username,
    role: 'user',
    createdAt: new Date().toISOString(),
  }
  memDb.profiles.set(id, profile)
  return c.json({ success: true, user: profile })
})

// 3. Conversations & Messages
app.get('/api/conversations', async (c) => {
  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const convRows = await db.prepare('SELECT * FROM conversations ORDER BY updatedAt DESC').all()
    const results = []
    for (const conv of convRows.results || []) {
      const lastMsg = await db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC LIMIT 1').bind(conv.id).first()
      const otherProfile = await db.prepare('SELECT username, displayName FROM profiles WHERE userId = ?').bind(conv.userBId).first()
      results.push({
        id: conv.id,
        otherUser: otherProfile || { username: conv.userBId, displayName: `@${conv.userBId}` },
        status: conv.status,
        lastMessage: lastMsg || null,
        remote: false,
        pending: false,
      })
    }
    return c.json({ conversations: results })
  }

  const convList = Array.from(memDb.conversations.values()).map((conv) => {
    const other = memDb.profiles.get(conv.userBId) || { username: conv.userBId, displayName: `@${conv.userBId}` }
    const convMsgs = memDb.messages.filter((m) => m.conversationId === conv.id)
    const lastMsg = convMsgs[convMsgs.length - 1] || null
    return {
      id: conv.id,
      otherUser: { username: other.username, displayName: other.displayName },
      status: conv.status,
      lastMessage: lastMsg,
      remote: false,
      pending: false,
    }
  })
  return c.json({ conversations: convList })
})

app.get('/api/messaging', async (c) => {
  const conversationId = c.req.query('conversationId')
  if (!conversationId) return c.json({ messages: [] })

  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const rows = await db.prepare('SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC').bind(conversationId).all()
    return c.json({ messages: rows.results || [] })
  }

  const msgs = memDb.messages.filter((m) => m.conversationId === conversationId)
  return c.json({ messages: msgs })
})

app.post('/api/messaging', async (c) => {
  const { conversationId, body, recipientId, senderId } = await c.req.json()
  const actualSender = senderId || 'admin_1'
  const newMsg: Message = {
    id: 'msg_' + Math.random().toString(36).slice(2, 9),
    conversationId: conversationId || 'conv_1',
    senderId: actualSender,
    body: body || '',
    readAt: null,
    createdAt: new Date().toISOString(),
  }

  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    await db.prepare('INSERT INTO messages (id, conversationId, senderId, body, readAt, createdAt) VALUES (?, ?, ?, ?, NULL, ?)')
      .bind(newMsg.id, newMsg.conversationId, newMsg.senderId, newMsg.body, newMsg.createdAt).run()
    await db.prepare("UPDATE conversations SET updatedAt = ? WHERE id = ?").bind(newMsg.createdAt, newMsg.conversationId).run()
  } else {
    memDb.messages.push(newMsg)
  }

  broadcastSSE('message', newMsg)
  return c.json({ success: true, message: newMsg })
})

// 4. Server-Sent Events (SSE) Stream
app.get('/api/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const clientId = Math.random().toString(36).slice(2, 9)
    const client: SSEClient = {
      id: clientId,
      userId: 'default',
      write: (data: string) => {
        stream.write(data)
      },
    }
    sseClients.add(client)

    // Initial keepalive and greeting
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ clientId, timestamp: new Date().toISOString() }),
    })

    // 100-second stream keep-alive interval as per system design
    const interval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ t: Date.now() }),
        })
      } catch {
        clearInterval(interval)
        sseClients.delete(client)
      }
    }, 15000)

    stream.onAbort(() => {
      clearInterval(interval)
      sseClients.delete(client)
    })

    // Keep stream open
    await new Promise((resolve) => setTimeout(resolve, 95000))
    clearInterval(interval)
    sseClients.delete(client)
  })
})

// 5. Federation Identity & Manifest
app.get('/api/federation/identity', (c) => {
  return c.json({
    version: '1.0.0',
    serverType: 'chatze-nepal-edge',
    publicKey: 'ed25519-public-key-zero-setup-ktm',
    features: ['sse-realtime', 'd1-persistence', 'zero-bot-filter'],
  })
})

app.get('/api/federation/v1/manifest', (c) => {
  return c.json({
    nodeId: 'ktm-edge-node-1',
    country: 'NP',
    protocols: ['chatze-federation-v1'],
  })
})

// 6. Data Retention Cron
app.post('/api/cron/retention', async (c) => {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
  const db = c.env?.DB
  if (db) {
    await ensureD1Tables(db)
    const res = await db.prepare('DELETE FROM messages WHERE createdAt < ?').bind(sixtyDaysAgo).run()
    return c.json({ cleaned: res.meta?.changes || 0 })
  }
  const beforeCount = memDb.messages.length
  memDb.messages = memDb.messages.filter((m) => m.createdAt >= sixtyDaysAgo)
  return c.json({ cleaned: beforeCount - memDb.messages.length })
})

app.get('/api/health', (c) => c.json({ status: 'ok', engine: 'hono-cloudflare-workers' }))

export default app
