import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { RouteMeta } from './seo/RouteMeta'
import { initSupabase } from '@pharmstation/supabase-client'
import '@pharmstation/ui/src/styles/globals.css'
import './styles/app.css'

// Initialize dual Supabase clients
initSupabase({
  url: import.meta.env.VITE_SUPABASE_URL,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteMeta />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
