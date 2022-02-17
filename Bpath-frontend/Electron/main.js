const path = require('path')
const { app, BrowserWindow, Menu, dialog } = require('electron')
const isDev = require('electron-is-dev')
const http = require('http')
const serveHandler = require('serve-handler')
require('./fn')

const server = http.createServer((req, res) => {
  return serveHandler(req, res, {
    public: __dirname + '/render'
  })
});

let mainWindow
function createWindow() {
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    // show: false,
    // backgroundColor: '#000',
    width: 1800,
    height: 1200,
    webPreferences: {
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      webSecurity: false,
      experimentalFeatures: true
    }
  })

  let contentLoaded = false;
  if (isDev) {
    mainWindow.webContents.openDevTools()
    // mainWindow.loadURL('http://127.0.0.1:3000')
    // contentLoaded = true;
  }
  if(!contentLoaded) {
    // mainWindow.loadFile(path.join('.', 'render', 'index.html')) // tfjs cannot be run based on file schema
    server.listen(0, 'localhost', () => {
      url = 'http://localhost:' + (server.address().port) + '/';
      console.log('url', url);
      mainWindow.loadURL(url)
    });
  }

  //mainWindow.webContents.openDevTools({mode:'right'})
  // mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

app.on('ready', createWindow)
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})
