import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { useSettings } from './lib/api'
import { PlatformsProvider } from './lib/platforms'
import { useApp } from './lib/store'
import { Accounts } from './pages/Accounts'
import { Analytics } from './pages/Analytics'
import { Calendar } from './pages/Calendar'
import { Composer } from './pages/Composer'
import { Dashboard } from './pages/Dashboard'
import { Library } from './pages/Library'
import { SettingsPage } from './pages/Settings'

export function App(): React.JSX.Element {
  const route = useApp((s) => s.route)
  const { data: settings } = useSettings()

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme
  }, [settings])

  return (
    <PlatformsProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="drag h-10 shrink-0" />
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
            <div key={route.page + ('postId' in route ? (route.postId ?? '') : '')} className="fade-in">
              {route.page === 'dashboard' && <Dashboard />}
              {route.page === 'calendar' && <Calendar />}
              {route.page === 'compose' && <Composer postId={route.postId} prefillDate={route.prefillDate} />}
              {route.page === 'library' && <Library />}
              {route.page === 'analytics' && <Analytics />}
              {route.page === 'accounts' && <Accounts />}
              {route.page === 'settings' && <SettingsPage />}
            </div>
          </div>
        </main>
      </div>
      <Toasts />
    </PlatformsProvider>
  )
}
