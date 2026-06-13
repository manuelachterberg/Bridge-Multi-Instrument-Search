import { getSettings } from '../SettingsHandler.ipc.js'
import { getSpotifyAccessToken } from './SpotifyAuth.js'
import { getSpotifyCurrentUser, getSpotifyPlaylist, getSpotifyPlaylistTracks } from './SpotifyApi.js'

export async function fetchSpotifyPlaylistTracks(playlistId: string) {
	const settings = await getSettings()
	if (!settings.spotifyClientId) {
		throw new Error('Spotify Client ID is required. Please set it in Settings.')
	}

	const accessToken = await getSpotifyAccessToken()
	const currentUser = await getSpotifyCurrentUser(accessToken)
	const playlist = await getSpotifyPlaylist(playlistId, accessToken)
	if (!currentUser.id) {
		throw new Error('Spotify login did not return a user id.')
	}

	if (playlist.owner.id !== currentUser.id) {
		throw new Error(`Spotify account mismatch: logged in as ${currentUser.id} (${currentUser.display_name ?? 'unknown'}), playlist owner is ${playlist.owner.id} (${playlist.owner.display_name ?? 'unknown'}).`)
	}

	return getSpotifyPlaylistTracks(playlistId, accessToken, currentUser.country ?? 'DE')
}
