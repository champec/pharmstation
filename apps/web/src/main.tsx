import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { RouteMeta } from './seo/RouteMeta'
import { DialogHost } from './components/ui/dialog'
import { AppErrorBoundary, RouteTracker } from './components/Monitoring'
import { initSupabase } from '@pharmstation/supabase-client'
import '@pharmstation/ui/src/styles/globals.css'
import './styles/app.css'
import './styles/logs.css'

// Initialize dual Supabase clients
initSupabase({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <RouteMeta />
        <RouteTracker />
        <App />
        <DialogHost />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>,
)
