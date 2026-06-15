import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import * as path from 'path'
import * as url from 'url'

import { IpcFromMainEmitEvents } from '../src-shared/interfaces/ipc.interface.js'
import { dataPath } from '../src-shared/Paths.js'
import { settings } from './ipc/SettingsHandler.ipc.js'
import { retryUpdate } from './ipc/UpdateHandler.ipc.js'
import { getIpcInvokeHandlers, getIpcToMainEmitHandlers } from './IpcHandler.js'

const _filename = url.fileURLToPath(import.meta.url)
const _dirname = path.dirname(_filename)
const windowStatePath = path.join(dataPath, 'window-state.json')
const startupLogPath = path.join(dataPath, 'startup.log')

export let mainWindow: BrowserWindow | undefined
const args = process.argv.slice(1)
const isDevBuild = args.some(val => val === '--dev')

installUnhandledHandlers()
restrictToSingleInstance()
handleOSXWindowClosed()
app.on('ready', async () => {
	logStartup('app ready')
	try {
		await createBridgeWindow()
		if (!isDevBuild) {
			retryUpdate()
		}
	} catch (err) {
		logStartup(`window startup failed: ${inspectError(err)}`)
		dialog.showErrorBox('Bridge startup failed', inspectError(err))
	}
})

/**
 * Only allow a single Bridge window to be open at any one time.
 * If this is attempted, restore the open window instead.
 */
function restrictToSingleInstance() {
	const isFirstBridgeInstance = app.requestSingleInstanceLock()
	if (!isFirstBridgeInstance) {
		logStartup('single instance lock denied; quitting')
		app.quit()
	}
	app.on('second-instance', () => {
		if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
			if (mainWindow.isMinimized()) mainWindow.restore()
			if (!mainWindow.isVisible()) mainWindow.show()
			mainWindow.focus()
		}
	})
}

/**
 * Standard OSX window functionality is to
 * minimize when closed and maximize when opened.
 */
function handleOSXWindowClosed() {
	app.on('window-all-closed', () => {
		if (process.platform !== 'darwin') {
			app.quit()
		}
	})

	app.on('activate', () => {
		if (mainWindow === undefined || mainWindow.isDestroyed()) {
			createBridgeWindow()
		} else {
			if (mainWindow.isMinimized()) mainWindow.restore()
			if (!mainWindow.isVisible()) mainWindow.show()
			mainWindow.focus()
		}
	})
}

/**
 * Launches and initializes Bridge's main window.
 */
async function createBridgeWindow() {
	logStartup('create window begin')
	const windowState = getWindowState()
	// Create the browser window
	mainWindow = createBrowserWindow(windowState)
	logStartup(`window created: ${JSON.stringify(mainWindow.getBounds())}`)
	manageWindowState(mainWindow, windowState)

	// Don't use a system menu
	mainWindow.setMenu(null)

	// Set user-specified zoom level
	mainWindow.webContents.setZoomFactor(settings.zoomFactor)

	// IPC handlers
	for (const [key, handler] of Object.entries(getIpcInvokeHandlers())) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		ipcMain.handle(key, (_event, ...args) => (handler as any)(args[0]))
	}
	for (const [key, handler] of Object.entries(getIpcToMainEmitHandlers())) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		ipcMain.on(key, (_event, ...args) => (handler as any)(args[0]))
	}
	mainWindow.on('unmaximize', () => emitIpcEvent('minimized', undefined))
	mainWindow.on('maximize', () => emitIpcEvent('maximized', undefined))
	mainWindow.webContents.on('did-finish-load', () => logStartup('renderer did-finish-load'))
	mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
		logStartup(`renderer did-fail-load ${errorCode}: ${errorDescription} ${validatedUrl}`)
	})
	mainWindow.webContents.on('render-process-gone', (_event, details) => {
		logStartup(`renderer process gone: ${JSON.stringify(details)}`)
	})
	mainWindow.on('closed', () => {
		logStartup('window closed')
		mainWindow = undefined
	})

	// Load angular app
	await loadWindow()
	logStartup('loadWindow completed')
	mainWindow.show()
	mainWindow.focus()
	logStartup(`window shown visible=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} bounds=${JSON.stringify(mainWindow.getBounds())}`)

	if (isDevBuild) {
		mainWindow.webContents.openDevTools()
	}
}

/**
 * Initialize a BrowserWindow object with initial parameters
 */
function createBrowserWindow(windowState: WindowState) {
	let options: Electron.BrowserWindowConstructorOptions = {
		x: windowState.x,
		y: windowState.y,
		width: windowState.width,
		height: windowState.height,
		frame: false,
		title: 'Bridge',
		webPreferences: {
			preload: path.join(_dirname, 'preload.mjs'),
			allowRunningInsecureContent: (isDevBuild) ? true : false,
			textAreasAreResizable: false,
		},
		simpleFullscreen: true,
		fullscreenable: false,
		backgroundColor: '#121212',
	}

	if (process.platform === 'linux' && !isDevBuild) {
		options = Object.assign(options, { icon: path.join(_dirname, '..', 'assets', 'images', 'system', 'icons', 'png', '48x48.png') })
	}

	return new BrowserWindow(options)
}

type WindowState = {
	width: number
	height: number
	x?: number
	y?: number
	isMaximized?: boolean
	isFullScreen?: boolean
	displayBounds?: Electron.Rectangle
}

function getWindowState(): WindowState {
	const defaultState: WindowState = {
		width: 1000,
		height: 800,
		x: 0,
		y: 0,
	}

	try {
		if (!existsSync(windowStatePath)) {
			return defaultState
		}

		const state = JSON.parse(readFileSync(windowStatePath, 'utf8')) as WindowState
		if (isValidWindowState(state)) {
			return state
		}
	} catch (err) {
	}

	return defaultState
}

function manageWindowState(win: BrowserWindow, state: WindowState) {
	const saveState = () => {
		try {
			const bounds = win.getBounds()
			const state: WindowState = {
				width: bounds.width,
				height: bounds.height,
				x: bounds.x,
				y: bounds.y,
				isMaximized: win.isMaximized(),
				isFullScreen: win.isFullScreen(),
				displayBounds: screen.getDisplayMatching(bounds).bounds,
			}

			if (win.isMaximized() || win.isFullScreen()) {
				const normalBounds = win.getNormalBounds()
				state.width = normalBounds.width
				state.height = normalBounds.height
				state.x = normalBounds.x
				state.y = normalBounds.y
			}

			mkdirSync(path.dirname(windowStatePath), { recursive: true })
			writeFileSync(windowStatePath, JSON.stringify(state), { encoding: 'utf8' })
		} catch (err) {
		}
	}

	if (state.isMaximized) {
		win.maximize()
	}
	if (state.isFullScreen) {
		win.setFullScreen(true)
	}

	win.on('resize', saveState)
	win.on('move', saveState)
	win.on('close', saveState)
	win.on('closed', saveState)
}

function isValidWindowState(state: WindowState) {
	if (state === undefined) {
		return false
	}

	if (!Number.isInteger(state.width) || state.width <= 0) {
		return false
	}
	if (!Number.isInteger(state.height) || state.height <= 0) {
		return false
	}
	if (state.x !== undefined && !Number.isInteger(state.x)) {
		return false
	}
	if (state.y !== undefined && !Number.isInteger(state.y)) {
		return false
	}

	if (state.displayBounds !== undefined && state.x !== undefined && state.y !== undefined) {
		const visible = screen.getAllDisplays().some(display => {
			return state.x! >= display.bounds.x
				&& state.y! >= display.bounds.y
				&& state.x! + state.width <= display.bounds.x + display.bounds.width
				&& state.y! + state.height <= display.bounds.y + display.bounds.height
		})

		if (!visible) {
			return false
		}
	}

	return true
}

async function loadWindow(retries = 0) {
	if (retries > 10) { throw new Error(`Angular frontend did not load.\nLoad URL: ${getLoadUrl()}`) }
	try {
		if (isDevBuild) {
			await mainWindow!.loadURL(getLoadUrl())
		} else {
			await mainWindow!.loadFile(path.join(_dirname, '..', '..', 'angular', 'browser', 'index.html'))
		}
	} catch (err) {
		await new Promise<void>(resolve => setTimeout(resolve, 1000))
		await loadWindow(retries + 1)
	}
}

function installUnhandledHandlers() {
	process.on('uncaughtException', err => {
		logStartup(`uncaughtException: ${inspectError(err)}`)
		console.log('Error: Uncaught Exception:', err)
	})
	process.on('unhandledRejection', err => {
		logStartup(`unhandledRejection: ${inspectError(err)}`)
		console.log('Error: Unhandled Rejection:', err)
	})
}

function logStartup(message: string) {
	try {
		mkdirSync(path.dirname(startupLogPath), { recursive: true })
		appendFileSync(startupLogPath, `${new Date().toISOString()} ${message}\n`)
	} catch (err) {
	}
}

function inspectError(err: unknown) {
	if (err instanceof Error) {
		return `${err.stack ?? err.message}`
	}

	return String(err)
}

/**
 * Load from localhost during development; load from index.html in production
 */
function getLoadUrl() {
	return url.format({
		protocol: isDevBuild ? 'http:' : 'file:',
		pathname: isDevBuild ? '//localhost:4200/' : path.join(_dirname, '..', '..', 'angular', 'browser', 'index.html'),
		slashes: true,
	})
}

export function emitIpcEvent<E extends keyof IpcFromMainEmitEvents>(event: E, data: IpcFromMainEmitEvents[E]) {
	try {
		mainWindow!.webContents.send(event, data)
	} catch (err) {
		// Ignore; happens when closing Bridge
	}
}
