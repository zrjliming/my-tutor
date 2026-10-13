import './index.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { api } from './api'
import { setLang } from './i18n'

// 先读界面语言再渲染，避免首屏闪一下默认语言
void api.settings
  .get()
  .then((s) => setLang(s.uiLanguage))
  .catch(() => undefined)
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  })
