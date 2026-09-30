import React, { useState, useEffect } from 'react'
import { SetupWizard } from './components/SetupWizard'
import { AuthScreens } from './components/AuthScreens'
import { MessagingApp } from './components/MessagingApp'

export function App() {
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [displayName, setDisplayName] = useState('Chatze User')
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkState() {
      try {
        const setupRes = await fetch('/api/setup/status')
        if (setupRes.ok) {
          const setupData = await setupRes.json()
          if (setupData.setupRequired) {
            setSetupRequired(true)
            setLoading(false)
            return
          }
          setSetupRequired(false)
          if (setupData.displayName) setDisplayName(setupData.displayName)
        } else {
          // If uninitialized or database error, show setup wizard
          setSetupRequired(true)
          setLoading(false)
          return
        }

        // Check session
        const sessionRes = await fetch('/api/auth/session')
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json()
          if (sessionData.user) {
            setCurrentUser(sessionData.user)
          }
        }
      } catch (err) {
        console.warn('App init status check, defaulting to setup wizard', err)
        setSetupRequired(true)
      } finally {
        setLoading(false)
      }
    }
    checkState()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex flex-col items-center justify-center text-[#8696a0] gap-3 font-sans">
        <div className="w-8 h-8 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-medium tracking-wide">Connecting to Edge Cloud...</p>
      </div>
    )
  }

  if (setupRequired) {
    return (
      <SetupWizard
        onComplete={(name, handle) => {
          setDisplayName(name)
          setSetupRequired(false)
          setCurrentUser({
            id: 'usr_admin',
            handle: handle || 'admin',
            display_name: name,
            role: 'admin',
          })
        }}
      />
    )
  }

  if (!currentUser) {
    return <AuthScreens onLoginSuccess={(user) => setCurrentUser(user)} />
  }

  return (
    <MessagingApp
      currentUser={currentUser}
      businessName={displayName}
      onLogout={() => setCurrentUser(null)}
    />
  )
}

export default App
