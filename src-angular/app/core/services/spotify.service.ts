import { Injectable } from '@angular/core'

import { SpotifyTrack } from 'src-shared/interfaces/spotify.interface'

@Injectable({
	providedIn: 'root',
})
export class SpotifyService {

	/**
	 * Extracts a Spotify playlist ID from various playlist URL formats.
	 */
	extractPlaylistId(url: string): string | null {
		const trimmed = url.trim()
		// Match https://open.spotify.com/playlist/ID
		// or https://open.spotify.com/playlist/ID?si=...
		const match = trimmed.match(/playlist\/([a-zA-Z0-9]+)/)
		return match ? match[1] : null
	}

	/**
	 * Fetches tracks from a Spotify playlist via IPC.
	 */
	async fetchPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
		return window.electron.invoke.getSpotifyPlaylistTracks(playlistId)
	}
}
