import { SpotifyPlaylistResponse, SpotifyPlaylistTracksResponse, SpotifyTrack, SpotifyUserResponse } from '../../../src-shared/interfaces/spotify.interface.js'

const SPOTIFY_PLAYLIST_URL = 'https://api.spotify.com/v1/playlists'

export async function getSpotifyCurrentUser(accessToken: string): Promise<SpotifyUserResponse> {
	const response = await fetch('https://api.spotify.com/v1/me', {
		headers: {
			'Authorization': `Bearer ${accessToken}`,
		},
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Spotify current user request failed (${response.status}): ${errorText}`)
	}

	return response.json() as Promise<SpotifyUserResponse>
}

export async function getSpotifyPlaylist(playlistId: string, accessToken: string): Promise<SpotifyPlaylistResponse> {
	const response = await fetch(`${SPOTIFY_PLAYLIST_URL}/${playlistId}`, {
		headers: {
			'Authorization': `Bearer ${accessToken}`,
		},
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Spotify playlist metadata request failed (${response.status}): ${errorText}`)
	}

	return response.json() as Promise<SpotifyPlaylistResponse>
}

export async function getSpotifyPlaylistTracks(playlistId: string, accessToken: string, market: string): Promise<SpotifyTrack[]> {
	const tracks: SpotifyTrack[] = []
	let url: string | null = `${SPOTIFY_PLAYLIST_URL}/${playlistId}/items?limit=50&market=${market}&fields=next,total,items(item(type,name,artists(name),album(name)),track(type,name,artists(name),album(name)))`

	while (url) {
		const response = await fetch(url, {
			headers: {
				'Authorization': `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Spotify playlist request failed (${response.status}): ${errorText}`)
		}

		const data = await response.json() as SpotifyPlaylistTracksResponse

		for (const item of data.items) {
			const track = item.item ?? item.track
			if (track?.type === 'episode') {
				continue
			}

			if (track) {
				tracks.push({
					name: track.name,
					artist: track.artists.map(artist => artist.name).join(', '),
					album: track.album.name,
				})
			}
		}

		url = data.next
	}

	return tracks
}
