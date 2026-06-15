import { app } from 'electron'
import { inspect } from 'util'

import { UpdateProgress } from '../../src-shared/interfaces/update.interface.js'
import { emitIpcEvent } from '../main.js'

type AutoUpdater = typeof import('electron-updater')['autoUpdater']

let autoUpdater: AutoUpdater | null = null
let updateAvailable: 'yes' | 'no' | 'error' = 'no'
let downloading = false
let updaterInitialized = false

async function getAutoUpdater() {
	if (autoUpdater) {
		return autoUpdater
	}

	try {
		autoUpdater = (await import('electron-updater')).autoUpdater
		autoUpdater.autoDownload = false
		autoUpdater.logger = null

		if (!updaterInitialized) {
			updaterInitialized = true
			autoUpdater.on('error', (err: Error) => {
				updateAvailable = 'error'
				emitIpcEvent('updateError', inspect(err))
			})
			autoUpdater.on('update-available', info => {
				updateAvailable = 'yes'
				emitIpcEvent('updateAvailable', info)
			})
			autoUpdater.on('update-not-available', () => {
				updateAvailable = 'no'
				emitIpcEvent('updateAvailable', null)
			})
		}

		return autoUpdater
	} catch (err) {
		updateAvailable = 'error'
		emitIpcEvent('updateError', inspect(err))
		return null
	}
}

export async function retryUpdate() {
	const updater = await getAutoUpdater()
	if (!updater) {
		return
	}

	try {
		await updater.checkForUpdates()
	} catch (err) {
		updateAvailable = 'error'
		emitIpcEvent('updateError', inspect(err))
	}
}

export async function getUpdateAvailable() {
	return updateAvailable
}

/**
 * @returns the current version of Bridge.
 */
export async function getCurrentVersion() {
	const updater = await getAutoUpdater()
	return updater?.currentVersion.raw ?? app.getVersion()
}

/**
 * Begins the process of downloading the latest update.
 */
export async function downloadUpdate() {
	if (downloading) { return }

	const updater = await getAutoUpdater()
	if (!updater) {
		return
	}

	downloading = true

	updater.on('download-progress', (updateProgress: UpdateProgress) => {
		emitIpcEvent('updateProgress', updateProgress)
	})

	updater.on('update-downloaded', () => {
		emitIpcEvent('updateDownloaded', undefined)
	})

	await updater.downloadUpdate()
}

/**
 * Immediately closes the application and installs the update.
 */
export async function quitAndInstall() {
	const updater = await getAutoUpdater()
	updater?.quitAndInstall()
}
