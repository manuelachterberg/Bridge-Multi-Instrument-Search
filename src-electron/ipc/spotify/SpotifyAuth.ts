import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'

import { shell } from 'electron'

import { getSettings, setSettings } from '../SettingsHandler.ipc.js'

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize'
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8888/callback'
const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-read-private'

export async function getSpotifyAccessToken() {
	const settings = await getSettings()
	const clientId = settings.spotifyClientId
	if (!clientId) {
		throw new Error('Spotify Client ID is required. Please set it in Settings.')
	}

	if (settings.spotifyRefreshToken) {
		try {
			return await refreshSpotifyAccessToken(clientId, settings.spotifyRefreshToken)
		} catch (err) {
			if (isRevokedRefreshTokenError(err)) {
				await clearSpotifyRefreshToken()
				return authorizeSpotify(clientId)
			}
			throw err
		}
	}

	return authorizeSpotify(clientId)
}

async function authorizeSpotify(clientId: string) {
	const codeVerifier = generateCodeVerifier()
	const codeChallenge = generateCodeChallenge(codeVerifier)
	const state = randomBytes(16).toString('hex')
	const authUrl = new URL(SPOTIFY_AUTH_URL)
	authUrl.searchParams.set('response_type', 'code')
	authUrl.searchParams.set('client_id', clientId)
	authUrl.searchParams.set('scope', SPOTIFY_SCOPES)
	authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI)
	authUrl.searchParams.set('code_challenge_method', 'S256')
	authUrl.searchParams.set('code_challenge', codeChallenge)
	authUrl.searchParams.set('state', state)
	authUrl.searchParams.set('show_dialog', 'true')

	const code = await waitForSpotifyAuthorizationCode(authUrl.toString(), state)
	const tokenResponse = await exchangeSpotifyCodeForToken(clientId, code, codeVerifier)

	if (tokenResponse.refresh_token) {
		const settings = await getSettings()
		await setSettings({
			...settings,
			spotifyRefreshToken: tokenResponse.refresh_token,
		})
	}

	return tokenResponse.access_token
}

async function refreshSpotifyAccessToken(clientId: string, refreshToken: string) {
	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			client_id: clientId,
			refresh_token: refreshToken,
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Spotify token refresh failed (${response.status}): ${errorText}`)
	}

	const tokenResponse = await response.json() as { access_token: string; refresh_token?: string }
	if (tokenResponse.refresh_token) {
		const settings = await getSettings()
		await setSettings({
			...settings,
			spotifyRefreshToken: tokenResponse.refresh_token,
		})
	}

	return tokenResponse.access_token
}

function isRevokedRefreshTokenError(err: unknown) {
	return err instanceof Error
		&& err.message.includes('Spotify token refresh failed (400)')
		&& err.message.includes('"invalid_grant"')
		&& err.message.includes('Refresh token revoked')
}

async function clearSpotifyRefreshToken() {
	const settings = await getSettings()
	if (!settings.spotifyRefreshToken) {
		return
	}

	await setSettings({
		...settings,
		spotifyRefreshToken: undefined,
	})
}

async function exchangeSpotifyCodeForToken(clientId: string, code: string, codeVerifier: string) {
	const response = await fetch(SPOTIFY_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: clientId,
			code,
			redirect_uri: SPOTIFY_REDIRECT_URI,
			code_verifier: codeVerifier,
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Spotify authorization failed (${response.status}): ${errorText}`)
	}

	return response.json() as Promise<{ access_token: string; refresh_token?: string }>
}

function waitForSpotifyAuthorizationCode(authUrl: string, expectedState: string) {
	return new Promise<string>((resolve, reject) => {
		let settled = false
		let timeout: NodeJS.Timeout | undefined
		const finish = (callback: () => void) => {
			if (settled) { return }
			settled = true
			if (timeout) {
				clearTimeout(timeout)
			}
			callback()
		}

		const server = createServer((req, res) => {
			try {
				const requestUrl = new URL(req.url ?? '/', SPOTIFY_REDIRECT_URI)
				if (requestUrl.pathname !== '/callback') {
					res.writeHead(404)
					res.end()
					return
				}

				const error = requestUrl.searchParams.get('error')
				if (error) {
					const errorDescription = requestUrl.searchParams.get('error_description')
					res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end('<h1>Spotify login failed</h1><p>You can close this tab.</p>')
					finish(() => {
						server.close()
						reject(new Error(`Spotify authorization failed: ${error}${errorDescription ? `: ${errorDescription}` : ''}`))
					})
					return
				}

				const code = requestUrl.searchParams.get('code')
				const state = requestUrl.searchParams.get('state')
				if (!code || state !== expectedState) {
					res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
					res.end('<h1>Spotify login failed</h1><p>Invalid callback response. You can close this tab.</p>')
					finish(() => {
						server.close()
						reject(new Error('Spotify authorization callback was invalid.'))
					})
					return
				}

				res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
				res.end('<h1>Spotify connected</h1><p>You can close this tab and return to Bridge.</p>')
				finish(() => {
					server.close()
					resolve(code)
				})
			} catch (err) {
				finish(() => {
					server.close()
					reject(err)
				})
			}
		})

		server.listen(8888, '127.0.0.1', async () => {
			try {
				await shell.openExternal(authUrl)
			} catch (err) {
				server.close()
				reject(err)
			}
		})

		server.on('error', err => {
			finish(() => reject(err))
		})

		timeout = setTimeout(() => {
			finish(() => {
				try {
					server.close()
				} catch {
					// Ignore.
				}
				reject(new Error('Spotify authorization timed out.'))
			})
		}, 5 * 60 * 1000)
	})
}

function generateCodeVerifier() {
	return randomBytes(64).toString('base64url')
}

function generateCodeChallenge(codeVerifier: string) {
	return createHash('sha256').update(codeVerifier).digest('base64url')
}
