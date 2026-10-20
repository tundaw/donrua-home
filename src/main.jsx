import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const redirectedRoute = new URLSearchParams(window.location.search).get('__route')
if (redirectedRoute) {
  window.history.replaceState(null, '', `${import.meta.env.BASE_URL}${redirectedRoute}`)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
