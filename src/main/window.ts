import { BrowserWindow, session, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

export function installCsp(): void {
  const devExtra = is.dev ? ' http://localhost:* ws://localhost:*' : ''
  const csp = [
    `default-src 'self'`,
    // dev 下 @vitejs/plugin-react 会注入内联 React Refresh preamble，需放行内联脚本；生产构建不受影响
    `script-src 'self'${is.dev ? " 'unsafe-inline'" : ''}${devExtra}`,
    `style-src 'self' 'unsafe-inline'${devExtra}`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'${devExtra}`,
    `font-src 'self' data:`,
    `media-src 'self' blob:`
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] }
    })
  })
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 单页应用不需要任何导航；拖入文件等会触发 file:// 导航，一律拦下
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}
