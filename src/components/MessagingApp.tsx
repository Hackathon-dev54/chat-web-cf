import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Send,
  Search,
  MessageSquare,
  ShieldCheck,
  CheckCheck,
  LogOut,
  Bell,
  Sparkles,
  UserPlus,
  ArrowDown,
  QrCode,
  X,
  Clock,
  Globe,
  Share2,
  Copy,
  AlertCircle,
} from 'lucide-react'

interface Conversation {
  id: string
  otherUser: { id?: string; username: string; displayName: string }
  status?: string // 'active' | 'pending' | 'archived'
  remoteInstanceUrl?: string | null
  lastMessage?: { content: string; createdAt: number } | null
  unreadCount?: number
}

interface ChatMessage {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
  readAt?: string | null
  status?: 'sending' | 'sent' | 'delivered'
}

interface Friendship {
  id: string
  local_user_id: string
  remote_handle: string
  remote_instance_url: string
  status: string // 'pending' | 'active' | 'rejected'
  direction: 'incoming' | 'outgoing'
  created_at: number
}

const UNIVERSAL_QUICK_REPLIES = [
  { label: '👋 Hey there!', text: '👋 Hey! How are you doing?' },
  { label: '📍 Share Location', text: '📍 Meeting point / current location shared.' },
  { label: '✅ Sounds good!', text: '✅ Sounds great, let’s do that!' },
  { label: '📞 Call me later', text: '📞 A bit busy right now, call you in a bit.' },
  { label: '💳 Payment QR', text: '💳 Payment QR: eSewa, Khalti, or mobile banking accepted.' },
]

export function MessagingApp({
  currentUser,
  businessName,
  onLogout,
}: {
  currentUser: { id: string; handle: string; display_name: string; role?: string }
  businessName: string
  onLogout: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [inboxFilter, setInboxFilter] = useState<'all' | 'unread' | 'pending'>('all')

  // Federation & Contacts
  const [friendships, setFriendships] = useState<Friendship[]>([])
  const [showAddFriendModal, setShowAddFriendModal] = useState(false)
  const [showIdentityModal, setShowIdentityModal] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Add friend state
  const [friendHandle, setFriendHandle] = useState('')
  const [friendDomain, setFriendDomain] = useState('')
  const [sendingRequest, setSendingRequest] = useState(false)
  const [addFriendError, setAddFriendError] = useState('')

  // Stream state
  const [streamConnected, setStreamConnected] = useState(false)
  const [lastStreamActivity, setLastStreamActivity] = useState(Date.now())

  // Scroll states
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const [hasNewUnreadWhileScrolled, setHasNewUnreadWhileScrolled] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeConvRef = useRef<Conversation | null>(null)
  activeConvRef.current = activeConv

  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations')
      if (res.ok) {
        const data = await res.json()
        if (data.conversations) {
          setConversations(data.conversations)
          if (!activeConvRef.current && data.conversations.length > 0) {
            setActiveConv(data.conversations[0])
          } else if (activeConvRef.current) {
            const updated = data.conversations.find((c: any) => c.id === activeConvRef.current?.id)
            if (updated) setActiveConv(updated)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load conversations', err)
    }
  }

  const loadFriendships = async () => {
    try {
      const res = await fetch('/api/federation/friendships')
      if (res.ok) {
        const data = await res.json()
        if (data.friendships) setFriendships(data.friendships)
      }
    } catch (err) {
      console.error('Failed to load friendships', err)
    }
  }

  const loadMessages = async (convId: string) => {
    try {
      const res = await fetch(`/api/messaging?conversationId=${encodeURIComponent(convId)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.messages) {
          setMessages(data.messages)
        }
      }
    } catch (err) {
      console.error('Failed to load messages', err)
    }
  }

  useEffect(() => {
    loadConversations()
    loadFriendships()
  }, [])

  useEffect(() => {
    if (activeConv) {
      loadMessages(activeConv.id)
    }
  }, [activeConv?.id])

  // Periodic 3-second sync across Cloudflare Worker isolates
  useEffect(() => {
    const syncInterval = setInterval(() => {
      loadConversations()
      loadFriendships()
      if (activeConvRef.current && activeConvRef.current.status !== 'pending') {
        loadMessages(activeConvRef.current.id)
      }
    }, 3000)
    return () => clearInterval(syncInterval)
  }, [])

  const handleScroll = () => {
    const el = messagesContainerRef.current
    if (!el) return
    const isScrolledUp = el.scrollHeight - el.scrollTop - el.clientHeight > 90
    setShowScrollBottom(isScrolledUp)
    if (!isScrolledUp) setHasNewUnreadWhileScrolled(false)
  }

  const scrollToBottom = (behavior: 'smooth' | 'instant' = 'smooth') => {
    if (behavior === 'instant') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' })
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
    setHasNewUnreadWhileScrolled(false)
  }

  // SSE Stream
  useEffect(() => {
    let evtSource: EventSource | null = null
    let watchdogTimer: NodeJS.Timeout | null = null

    const connectStream = () => {
      if (evtSource) evtSource.close()
      try {
        evtSource = new EventSource(`/api/stream?userId=${encodeURIComponent(currentUser.id)}`)

        evtSource.addEventListener('connected', () => {
          setStreamConnected(true)
          setLastStreamActivity(Date.now())
        })

        evtSource.addEventListener('ping', () => {
          setStreamConnected(true)
          setLastStreamActivity(Date.now())
        })

        evtSource.addEventListener('new_message', (e) => {
          setLastStreamActivity(Date.now())
          try {
            const incoming: ChatMessage = JSON.parse(e.data)
            const currentActive = activeConvRef.current

            if (currentActive && incoming.conversationId === currentActive.id) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === incoming.id)) return prev
                return [...prev, incoming]
              })

              const el = messagesContainerRef.current
              const isScrolledUp = el && el.scrollHeight - el.scrollTop - el.clientHeight > 90
              if (isScrolledUp) {
                setHasNewUnreadWhileScrolled(true)
              } else {
                scrollToBottom('smooth')
              }
            }
            loadConversations()
          } catch (err) {
            console.warn('SSE parse error', err)
          }
        })

        evtSource.addEventListener('incoming_friend_request', () => {
          setLastStreamActivity(Date.now())
          loadFriendships()
          loadConversations()
        })

        evtSource.addEventListener('friend_accepted', () => {
          setLastStreamActivity(Date.now())
          loadFriendships()
          loadConversations()
          if (activeConvRef.current) {
            loadMessages(activeConvRef.current.id)
          }
        })

        evtSource.onerror = () => {
          setStreamConnected(false)
          evtSource?.close()
          setTimeout(connectStream, 1500)
        }
      } catch (err) {
        setStreamConnected(false)
      }
    }

    connectStream()

    watchdogTimer = setInterval(() => {
      if (Date.now() - lastStreamActivity > 15000) {
        connectStream()
      }
    }, 5000)

    const handleVisibilityChange = () => {
      if (!document.hidden && activeConvRef.current) {
        loadMessages(activeConvRef.current.id)
        loadConversations()
        loadFriendships()
      }
    }
    window.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleVisibilityChange)

    return () => {
      evtSource?.close()
      if (watchdogTimer) clearInterval(watchdogTimer)
      window.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleVisibilityChange)
    }
  }, [currentUser.id])

  // Send Contact Connection Request (Passes accurate origin & handle)
  const handleSendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!friendHandle.trim() || !friendDomain.trim()) return

    setSendingRequest(true)
    setAddFriendError('')

    try {
      const res = await fetch('/api/federation/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteHandle: friendHandle.trim(),
          remoteInstanceUrl: friendDomain.trim(),
          senderId: currentUser.id,
          myHandle: currentUser.handle,
          myDisplayName: currentUser.display_name,
          myInstanceUrl: window.location.origin,
        }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setFriendHandle('')
        setFriendDomain('')
        setShowAddFriendModal(false)
        await loadConversations()
        await loadFriendships()
        if (data.conversation) {
          setActiveConv({
            id: data.conversation.id,
            otherUser: {
              id: data.conversation.user_b,
              username: data.conversation.remote_handle,
              displayName: `@${data.conversation.remote_handle}`,
            },
            status: 'pending',
            remoteInstanceUrl: data.conversation.remote_instance_url,
            lastMessage: { content: data.conversation.last_message_snippet, createdAt: Date.now() },
          })
        }
      } else {
        setAddFriendError(data.error || 'Failed to send request')
      }
    } catch (err: any) {
      setAddFriendError(err?.message || 'Network error')
    } finally {
      setSendingRequest(false)
    }
  }

  // Accept Inbound Request
  const handleAcceptFriendRequest = async (remoteHandle: string, remoteInstanceUrl: string) => {
    try {
      const res = await fetch('/api/federation/requests/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remoteHandle,
          remoteInstanceUrl,
          myHandle: currentUser.handle,
        }),
      })
      if (res.ok) {
        await loadFriendships()
        await loadConversations()
      }
    } catch (err) {
      console.error('Accept error', err)
    }
  }

  // Decline Inbound Request
  const handleRejectFriendRequest = async (remoteHandle: string) => {
    try {
      const res = await fetch('/api/federation/requests/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteHandle }),
      })
      if (res.ok) {
        await loadFriendships()
        await loadConversations()
      }
    } catch (err) {
      console.error('Reject error', err)
    }
  }

  // Send Message (0ms Optimistic + Background Cross-Peer Forwarding)
  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault()
    const textToSend = customText || inputText.trim()
    if (!textToSend || !activeConv) return
    if (activeConv.status === 'pending') return

    const tempId = 'temp_' + Math.random().toString(36).slice(2, 9)
    const optimisticMessage: ChatMessage = {
      id: tempId,
      conversationId: activeConv.id,
      senderId: currentUser.id,
      body: textToSend,
      createdAt: new Date().toISOString(),
      status: 'sending',
    }

    setMessages((prev) => [...prev, optimisticMessage])
    if (!customText) setInputText('')
    scrollToBottom('instant')

    try {
      const res = await fetch('/api/messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: activeConv.id,
          body: textToSend,
          senderId: currentUser.id,
          tempId,
          remoteInstanceUrl: activeConv.remoteInstanceUrl,
          remoteHandle: activeConv.otherUser.username,
          myHandle: currentUser.handle,
        }),
      })
      const data = await res.json()
      if (res.ok && data.message) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...data.message, status: 'sent' } : m))
        )
      }
      loadConversations()
    } catch (err) {
      console.error('Failed to send message', err)
    }
  }

  const incomingRequests = useMemo(() => {
    return friendships.filter((f) => f.status === 'pending' && f.direction === 'incoming')
  }, [friendships])

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const matchesSearch =
        c.otherUser.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.otherUser.username.toLowerCase().includes(searchQuery.toLowerCase())
      if (!matchesSearch) return false
      if (inboxFilter === 'pending') return c.status === 'pending'
      if (inboxFilter === 'unread') return (c.unreadCount || 0) > 0
      return true
    })
  }, [conversations, searchQuery, inboxFilter])

  return (
    <div className="flex h-screen w-full bg-[#0b141a] text-[#e9edef] overflow-hidden font-sans select-none">
      {/* 1. Left Sidebar: WhatsApp Style Chats Queue */}
      <aside className="w-80 sm:w-96 border-r border-[#202c33] bg-[#111b21] flex flex-col shrink-0">
        {/* Header Bar */}
        <div className="p-3.5 border-b border-[#202c33] space-y-3 bg-[#202c33]/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-[#00a884]/20 border border-[#00a884]/30 flex items-center justify-center font-bold text-xs text-[#00a884]">
                {currentUser.display_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-semibold text-[#e9edef] leading-tight truncate max-w-[150px]">
                  {businessName || currentUser.display_name}
                </h1>
                <div className="flex items-center gap-1.5 text-[11px] text-[#8696a0]">
                  <span className="w-2 h-2 rounded-full bg-[#00a884] animate-pulse"></span>
                  <span className="truncate">@{currentUser.handle}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowIdentityModal(true)}
                title="My Instance Address / Share"
                className="p-2 rounded-full text-[#8696a0] hover:text-[#00a884] hover:bg-[#202c33] transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowQrModal(true)}
                title="Payment QR"
                className="p-2 rounded-full text-[#8696a0] hover:text-[#00a884] hover:bg-[#202c33] transition-colors"
              >
                <QrCode className="w-4 h-4" />
              </button>
              <button
                onClick={onLogout}
                title="Logout"
                className="p-2 rounded-full text-[#8696a0] hover:text-rose-400 hover:bg-[#202c33] transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Connect Contact Button */}
          <button
            onClick={() => setShowAddFriendModal(true)}
            className="w-full py-2 px-3 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-[#00a884]/20 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" /> + Connect Contact (Subdomain / Domain)
          </button>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8696a0]" />
            <input
              type="text"
              placeholder="Search or start new chat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-[#202c33] border border-[#222e35] rounded-xl text-xs text-[#e9edef] placeholder-[#8696a0] focus:outline-none focus:border-[#00a884] transition-all"
            />
          </div>

          {/* Chat Queue Filter Pills */}
          <div className="flex items-center gap-1 bg-[#0b141a]/60 p-1 rounded-xl border border-[#202c33] text-[11px]">
            <button
              onClick={() => setInboxFilter('all')}
              className={`flex-1 py-1 rounded-lg font-medium transition-all ${
                inboxFilter === 'all' ? 'bg-[#202c33] text-[#e9edef]' : 'text-[#8696a0] hover:text-[#e9edef]'
              }`}
            >
              All ({conversations.length})
            </button>
            <button
              onClick={() => setInboxFilter('pending')}
              className={`flex-1 py-1 rounded-lg font-medium transition-all ${
                inboxFilter === 'pending' ? 'bg-[#202c33] text-amber-400' : 'text-[#8696a0] hover:text-[#e9edef]'
              }`}
            >
              Pending ({conversations.filter((c) => c.status === 'pending').length})
            </button>
            <button
              onClick={() => setInboxFilter('unread')}
              className={`flex-1 py-1 rounded-lg font-medium transition-all ${
                inboxFilter === 'unread' ? 'bg-[#202c33] text-[#00a884]' : 'text-[#8696a0] hover:text-[#e9edef]'
              }`}
            >
              Unread
            </button>
          </div>
        </div>

        {/* Incoming Connection Requests Banner */}
        {incomingRequests.length > 0 && (
          <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-400">
              <span className="flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5" /> Incoming Connection Requests ({incomingRequests.length})
              </span>
            </div>
            {incomingRequests.map((req) => (
              <div key={req.id} className="p-2.5 bg-[#111b21] border border-[#202c33] rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#e9edef]">@{req.remote_handle}</span>
                  <span className="text-[10px] text-[#8696a0] truncate max-w-[130px]">
                    {req.remote_instance_url.replace(/^https?:\/\//, '')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAcceptFriendRequest(req.remote_handle, req.remote_instance_url)}
                    className="flex-1 py-1 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] font-bold rounded-lg text-[11px] transition-all cursor-pointer"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => handleRejectFriendRequest(req.remote_handle)}
                    className="px-3 py-1 bg-[#202c33] hover:bg-[#222e35] text-[#8696a0] rounded-lg text-[11px] transition-all cursor-pointer"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Chats Feed */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#202c33]/40">
          {filteredConversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8696a0] space-y-2">
              <MessageSquare className="w-8 h-8 mx-auto text-[#8696a0]/40 mb-2" />
              <p className="font-medium text-[#e9edef]">No chats in this queue</p>
              <p className="text-[11px] text-[#8696a0]">
                Click "+ Connect Contact" above to connect to another deployed instance.
              </p>
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isActive = activeConv?.id === conv.id
              const isPending = conv.status === 'pending'
              return (
                <div
                  key={conv.id}
                  onClick={() => setActiveConv(conv)}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors relative ${
                    isActive ? 'bg-[#2a3942]' : 'hover:bg-[#202c33]/40'
                  }`}
                >
                  <div className="w-11 h-11 rounded-full bg-[#202c33] border border-[#222e35] flex items-center justify-center font-bold text-xs text-[#00a884] shrink-0">
                    {conv.otherUser.displayName.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#e9edef] truncate">
                        {conv.otherUser.displayName}
                      </span>
                      {conv.lastMessage && (
                        <span className="text-[10px] text-[#8696a0] shrink-0">
                          {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between mt-1">
                      <p className="text-[11px] text-[#8696a0] truncate max-w-[180px]">
                        {conv.lastMessage?.content || (isPending ? 'Waiting for approval...' : 'Connected')}
                      </p>
                      {isPending && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                          Pending
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      {/* 2. Main Chat Panel (WhatsApp Chat View) */}
      <main className="flex-1 flex flex-col bg-[#0b141a] min-w-0 relative">
        {activeConv ? (
          <>
            {/* Active Header */}
            <div className="h-16 px-5 border-b border-[#202c33] flex items-center justify-between bg-[#202c33]/70 shrink-0 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#111b21] border border-[#222e35] flex items-center justify-center font-bold text-xs text-[#00a884]">
                  {activeConv.otherUser.displayName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-[#e9edef] flex items-center gap-2">
                    {activeConv.otherUser.displayName}
                    {activeConv.status === 'pending' ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-normal bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Waiting for Approval
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-normal bg-[#00a884]/10 text-[#00a884] border border-[#00a884]/20">
                        Online
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-[#8696a0]">
                    {activeConv.remoteInstanceUrl
                      ? activeConv.remoteInstanceUrl.replace(/^https?:\/\//, '')
                      : `@${activeConv.otherUser.username}`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-[#8696a0]">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111b21] border border-[#202c33] text-[11px]">
                  <span className={`w-2 h-2 rounded-full ${streamConnected ? 'bg-[#00a884]' : 'bg-amber-400 animate-ping'}`} />
                  {streamConnected ? '100s SSE Live' : 'Reconnecting...'}
                </span>
              </div>
            </div>

            {/* Conversation Messages OR Pending Screen */}
            {activeConv.status === 'pending' ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 max-w-md mx-auto">
                <div className="p-4 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Clock className="w-12 h-12 animate-pulse" />
                </div>
                <h3 className="text-lg font-bold text-[#e9edef]">Connection Request Pending</h3>
                <p className="text-xs text-[#8696a0] leading-relaxed">
                  You sent a connection request to <strong className="text-[#e9edef]">@{activeConv.otherUser.username}</strong> on{' '}
                  <span className="text-[#00a884] font-mono">{activeConv.remoteInstanceUrl || 'their instance'}</span>.
                </p>
                <div className="p-3 bg-[#111b21] border border-[#202c33] rounded-xl text-[11px] text-[#8696a0] text-left space-y-1 w-full">
                  <p className="text-[#e9edef] font-medium flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-[#00a884]" /> WhatsApp-Grade Peer Handshake:
                  </p>
                  <p>1. They log in to their deployed instance and click <strong>Accept</strong>.</p>
                  <p>2. Once accepted, real-time messaging unlocks instantly on both devices in <strong>0ms</strong>.</p>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs text-amber-400/90 font-medium bg-amber-500/10 border border-amber-500/20 py-2.5 px-4 rounded-xl w-full">
                  <Clock className="w-4 h-4 animate-spin text-amber-400" />
                  <span>Waiting for @{activeConv.otherUser.username} to accept your request...</span>
                </div>
              </div>
            ) : (
              <div
                ref={messagesContainerRef}
                onScroll={handleScroll}
                className="flex-1 overflow-y-auto p-6 space-y-3 min-h-0 bg-[#0b141a]"
              >
                {messages.map((msg) => {
                  const isMe = msg.senderId === currentUser.id
                  return (
                    <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm shadow-sm transition-all ${
                          isMe
                            ? 'bg-[#005c4b] text-[#e9edef] rounded-br-none'
                            : 'bg-[#202c33] text-[#e9edef] rounded-bl-none'
                        }`}
                      >
                        <p className="break-words leading-relaxed">{msg.body}</p>
                        <div
                          className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${
                            isMe ? 'text-[#8696a0]' : 'text-[#8696a0]'
                          }`}
                        >
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMe && (
                            msg.status === 'sending' ? (
                              <Clock className="w-3 h-3 animate-spin text-[#8696a0]" />
                            ) : (
                              <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Scroll to Bottom Button */}
            {showScrollBottom && (
              <button
                onClick={() => scrollToBottom('smooth')}
                className="absolute bottom-24 right-8 p-3 rounded-full bg-[#202c33] border border-[#222e35] text-[#00a884] shadow-xl hover:bg-[#2a3942] transition-all flex items-center gap-1.5 text-xs cursor-pointer z-20"
              >
                <ArrowDown className="w-4 h-4" />
                {hasNewUnreadWhileScrolled && (
                  <span className="px-1.5 py-0.5 rounded-full bg-[#00a884] text-[#111b21] font-bold text-[10px]">
                    New
                  </span>
                )}
              </button>
            )}

            {/* Quick Replies Bar */}
            {activeConv.status !== 'pending' && (
              <div className="px-5 py-2 border-t border-[#202c33] bg-[#111b21]/70 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
                <span className="text-[11px] font-semibold text-[#8696a0] uppercase tracking-wider shrink-0 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-[#00a884]" /> Quick:
                </span>
                {UNIVERSAL_QUICK_REPLIES.map((reply, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendMessage(undefined, reply.text)}
                    className="px-3 py-1 bg-[#202c33] hover:bg-[#2a3942] border border-[#222e35] rounded-full text-xs text-[#e9edef] whitespace-nowrap transition-colors shrink-0 cursor-pointer"
                  >
                    {reply.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input Composer Bar */}
            <form
              onSubmit={handleSendMessage}
              className="p-3.5 border-t border-[#202c33] bg-[#202c33]/50 flex items-center gap-3 shrink-0"
            >
              <input
                type="text"
                disabled={activeConv.status === 'pending'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  activeConv.status === 'pending'
                    ? 'Waiting for contact to approve connection request...'
                    : 'Type a message (Enter to send)...'
                }
                className="flex-1 bg-[#2a3942] border border-[#222e35] rounded-xl px-4 py-2.5 text-sm text-[#e9edef] placeholder-[#8696a0] focus:outline-none focus:border-[#00a884] disabled:opacity-40 transition-all"
              />
              <button
                type="submit"
                disabled={activeConv.status === 'pending' || !inputText.trim()}
                className="p-2.5 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-40 text-[#111b21] font-bold rounded-xl transition-all shadow-md shadow-[#00a884]/20 cursor-pointer"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4 max-w-sm mx-auto">
            <div className="p-4 rounded-3xl bg-[#111b21] border border-[#202c33] text-[#8696a0]">
              <MessageSquare className="w-12 h-12 text-[#00a884]" />
            </div>
            <h3 className="text-base font-bold text-[#e9edef]">Independent WhatsApp at Edge</h3>
            <p className="text-xs text-[#8696a0] leading-relaxed">
              Connect with any user across Cloudflare instances by adding their username and subdomain/domain.
            </p>
            <button
              onClick={() => setShowAddFriendModal(true)}
              className="py-2.5 px-4 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-[#00a884]/20"
            >
              <UserPlus className="w-4 h-4" /> Connect Contact
            </button>
          </div>
        )}
      </main>

      {/* 3. Connect Contact Modal */}
      {showAddFriendModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="max-w-md w-full bg-[#111b21] border border-[#202c33] rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884]">
                  <UserPlus className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-[#e9edef]">Connect Contact Instance</h3>
              </div>
              <button onClick={() => setShowAddFriendModal(false)} className="text-[#8696a0] hover:text-[#e9edef]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#8696a0] leading-relaxed">
              Enter your contact's username and their deployed Cloudflare Workers URL or domain to send an encrypted connection request.
            </p>

            {addFriendError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{addFriendError}</span>
              </div>
            )}

            <form onSubmit={handleSendFriendRequest} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#8696a0]">Contact's Username / Handle</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-[#8696a0] text-sm">@</span>
                  <input
                    type="text"
                    required
                    value={friendHandle}
                    onChange={(e) => setFriendHandle(e.target.value)}
                    placeholder="e.g. suraj or alice"
                    className="w-full pl-8 pr-3.5 py-2.5 bg-[#202c33] border border-[#222e35] rounded-xl text-sm text-[#e9edef] focus:outline-none focus:border-[#00a884]"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[#8696a0]">Contact's Subdomain & Domain / URL</label>
                <div className="relative">
                  <Globe className="w-4 h-4 absolute left-3.5 top-3 text-[#8696a0]" />
                  <input
                    type="text"
                    required
                    value={friendDomain}
                    onChange={(e) => setFriendDomain(e.target.value)}
                    placeholder="e.g. chat-web-cfopou.askme50962.workers.dev"
                    className="w-full pl-10 pr-3.5 py-2.5 bg-[#202c33] border border-[#222e35] rounded-xl text-sm text-[#e9edef] focus:outline-none focus:border-[#00a884]"
                  />
                </div>
                <p className="text-[10px] text-[#8696a0] pl-1">
                  Their Cloudflare Workers domain (e.g. username.workers.dev)
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddFriendModal(false)}
                  className="px-4 py-2.5 text-xs text-[#8696a0] hover:text-[#e9edef]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sendingRequest || !friendHandle.trim() || !friendDomain.trim()}
                  className="px-5 py-2.5 bg-[#00a884] hover:bg-[#02906f] disabled:opacity-50 text-[#111b21] font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow-lg shadow-[#00a884]/20"
                >
                  {sendingRequest ? 'Dispatching...' : 'Send Friend Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. My Instance Address Modal */}
      {showIdentityModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="max-w-md w-full bg-[#111b21] border border-[#202c33] rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#00a884]/10 border border-[#00a884]/20 text-[#00a884]">
                  <Share2 className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-[#e9edef]">Your Chatze Address</h3>
              </div>
              <button onClick={() => setShowIdentityModal(false)} className="text-[#8696a0] hover:text-[#e9edef]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#8696a0] leading-relaxed">
              Share your username and instance domain with friends so they can add you from their own deployed app!
            </p>

            <div className="p-4 bg-[#0b141a] rounded-xl border border-[#202c33] space-y-3 text-xs">
              <div>
                <span className="text-[#8696a0] text-[11px] block">Your Username</span>
                <span className="text-[#00a884] font-bold font-mono text-sm">@{currentUser.handle}</span>
              </div>
              <div>
                <span className="text-[#8696a0] text-[11px] block">Your Deployed Domain</span>
                <span className="text-[#e9edef] font-mono text-xs break-all">
                  {typeof window !== 'undefined' ? window.location.origin : 'https://your-subdomain.workers.dev'}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                const text = `Connect with me on Chatze WhatsApp!\nUsername: @${currentUser.handle}\nInstance: ${window.location.origin}`
                navigator.clipboard.writeText(text)
                setCopiedLink(true)
                setTimeout(() => setCopiedLink(false), 2000)
              }}
              className="w-full py-2.5 bg-[#00a884] hover:bg-[#02906f] text-[#111b21] font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              {copiedLink ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedLink ? 'Copied to Clipboard!' : 'Copy Connection Details'}
            </button>
          </div>
        </div>
      )}

      {/* 5. Payment QR Modal */}
      {showQrModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="max-w-xs w-full bg-[#111b21] border border-[#202c33] rounded-2xl p-6 text-center space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#00a884] uppercase tracking-wider">
                Fonepay & eSewa QR
              </span>
              <button onClick={() => setShowQrModal(false)} className="text-[#8696a0] hover:text-[#e9edef]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-white rounded-xl mx-auto w-48 h-48 flex items-center justify-center">
              <QrCode className="w-40 h-40 text-slate-950" />
            </div>

            <div className="space-y-1 text-xs">
              <p className="font-semibold text-[#e9edef]">{currentUser.display_name}</p>
              <p className="text-[#8696a0]">Scan via eSewa, Khalti, or mobile banking</p>
            </div>

            <button
              onClick={() => {
                setShowQrModal(false)
                if (activeConv && activeConv.status !== 'pending') {
                  handleSendMessage(undefined, '💳 Scannable Payment QR: Open your eSewa, Khalti, or mobile banking app and scan to pay.')
                }
              }}
              className="w-full py-2.5 bg-[#00a884] text-[#111b21] font-bold rounded-xl text-xs hover:bg-[#02906f] transition-colors cursor-pointer"
            >
              Share QR in Chat
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
