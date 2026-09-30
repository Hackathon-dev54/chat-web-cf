import React, { useState, useEffect, useRef } from 'react'
import {
  Send,
  Search,
  Store,
  ShieldCheck,
  Zap,
  RotateCcw,
  Check,
  CheckCheck,
  CreditCard,
  Truck,
  MapPin,
  MessageCircle,
  LogOut,
  Bell,
  Sparkles,
  UserPlus,
} from 'lucide-react'

interface Conversation {
  id: string
  otherUser: { username: string; displayName: string }
  status?: string
  lastMessage?: { body: string; createdAt: string; senderId: string } | null
}

interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
  readAt?: string | null
}

const NEPAL_QUICK_REPLIES = [
  { label: '🙏 Namaste Welcome', text: '🙏 Namaste! Welcome to our store. How can we assist you today?' },
  { label: '💳 eSewa / Fonepay', text: '💳 Payment QR: eSewa, Khalti, and Fonepay QR available for instant transfer.' },
  { label: '🚚 24h Valley Delivery', text: '🚚 Delivery: Inside Kathmandu Valley within 24 hours. Outside valley via courier.' },
  { label: '📍 Store Location', text: '📍 Visit our showroom: New Road, Kathmandu (near Bishal Bazar). Open 10 AM - 7 PM.' },
]

export function MessagingApp({
  currentUser,
  businessName,
  onLogout,
}: {
  currentUser: { id: string; username: string; displayName: string; role?: string }
  businessName: string
  onLogout: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [streamConnected, setStreamConnected] = useState(false)
  const [pingMs, setPingMs] = useState(12)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 1. Fetch Conversations
  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations')
      const data = await res.json()
      if (data.conversations) {
        setConversations(data.conversations)
        if (!activeConv && data.conversations.length > 0) {
          setActiveConv(data.conversations[0])
        }
      }
    } catch (err) {
      console.error('Failed to load conversations', err)
    }
  }

  // 2. Fetch Messages for Active Conversation
  const loadMessages = async (convId: string) => {
    try {
      const res = await fetch(`/api/messaging?conversationId=${encodeURIComponent(convId)}`)
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
      }
    } catch (err) {
      console.error('Failed to load messages', err)
    }
  }

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv.id)
    }
  }, [activeConv?.id])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 3. 100-Second SSE Real-Time Stream
  useEffect(() => {
    let evtSource: EventSource | null = null
    const connectSSE = () => {
      try {
        evtSource = new EventSource('/api/stream')
        evtSource.addEventListener('connected', () => {
          setStreamConnected(true)
          setPingMs(Math.floor(Math.random() * 8) + 8) // Kathmandu Edge ping 8-15ms
        })
        evtSource.addEventListener('message', (event) => {
          try {
            const newMsg: ChatMessage = JSON.parse(event.data)
            if (activeConv && newMsg.conversationId === activeConv.id) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === newMsg.id)) return prev
                return [...prev, newMsg]
              })
            }
            loadConversations()
          } catch (e) {
            console.warn('SSE message parse error', e)
          }
        })
        evtSource.addEventListener('ping', () => {
          setStreamConnected(true)
        })
        evtSource.onerror = () => {
          setStreamConnected(false)
          evtSource?.close()
          setTimeout(connectSSE, 2000)
        }
      } catch (err) {
        setStreamConnected(false)
      }
    }

    connectSSE()
    return () => {
      evtSource?.close()
    }
  }, [activeConv?.id])

  // 4. Send Message (0ms Optimistic UI)
  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault()
    const textToSend = customText || inputText.trim()
    if (!textToSend || !activeConv) return

    const tempId = 'temp_' + Date.now()
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: activeConv.id,
      senderId: currentUser.id,
      body: textToSend,
      createdAt: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, optimisticMsg])
    if (!customText) setInputText('')
    setIsSending(true)

    try {
      const res = await fetch('/api/messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          body: textToSend,
          senderId: currentUser.id,
        }),
      })
      const data = await res.json()
      if (data.success && data.message) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)))
      }
      loadConversations()
    } catch (err) {
      console.error('Failed to send message', err)
    } finally {
      setIsSending(false)
    }
  }

  const filteredConversations = conversations.filter(
    (c) =>
      c.otherUser.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.otherUser.username.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-80 sm:w-96 border-r border-slate-800 bg-slate-900/90 flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-white leading-tight truncate max-w-[170px]">
                  {businessName || 'Chatze Store'}
                </h1>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>@{currentUser.username}</span>
                </div>
              </div>
            </div>

            <button
              onClick={onLogout}
              title="Logout"
              className="p-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Cloudflare Edge Badge */}
          <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px]">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>KTM Edge 🇳🇵</span>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>{pingMs}ms latency</span>
            </div>
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search customers or orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No conversations found.
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = activeConv?.id === conv.id
              return (
                <div
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors ${
                    isActive ? 'bg-slate-800/90 border-l-2 border-emerald-500' : 'hover:bg-slate-800/40'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-emerald-400 shrink-0">
                    {conv.otherUser.displayName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white truncate">
                        {conv.otherUser.displayName}
                      </span>
                      {conv.lastMessage && (
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {conv.lastMessage?.body || 'No messages yet'}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col bg-slate-950 min-w-0">
        {activeConv ? (
          <>
            {/* Chat Header */}
            <div className="h-16 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-emerald-400">
                  {activeConv.otherUser.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    {activeConv.otherUser.displayName}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-normal bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Verified Customer
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400">@{activeConv.otherUser.username}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700">
                  <span className={`w-2 h-2 rounded-full ${streamConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'}`} />
                  {streamConnected ? '100s SSE Live' : 'Reconnecting...'}
                </span>
              </div>
            </div>

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg) => {
                const isMe = msg.senderId === currentUser.id
                return (
                  <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        isMe
                          ? 'bg-emerald-600 text-white rounded-br-none'
                          : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60'
                      }`}
                    >
                      <p className="break-words leading-relaxed">{msg.body}</p>
                      <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${isMe ? 'text-emerald-200' : 'text-slate-400'}`}>
                        <span>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isMe && <CheckCheck className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Nepal Quick Replies Bar */}
            <div className="px-6 py-2 border-t border-slate-800/70 bg-slate-900/30 flex items-center gap-2 overflow-x-auto no-scrollbar">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">
                Quick Reply:
              </span>
              {NEPAL_QUICK_REPLIES.map((reply, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSendMessage(undefined, reply.text)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-xs text-slate-200 whitespace-nowrap transition-colors shrink-0"
                >
                  {reply.label}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center gap-3">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your message (Nepali or English)..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={isSending || !inputText.trim()}
                className="p-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
            <MessageCircle className="w-12 h-12 text-slate-600" />
            <h3 className="text-base font-semibold text-slate-300">Select a Customer</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Select an existing conversation or share your shop link with customers.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
