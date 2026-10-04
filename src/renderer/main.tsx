import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installBrowserPreviewShim } from './browser-preview-shim'
import './index.css'

// 浏览器直开 vite 页面时（无 Electron preload）注入只读预览垫片；Electron 内为空操作
installBrowserPreviewShim()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
