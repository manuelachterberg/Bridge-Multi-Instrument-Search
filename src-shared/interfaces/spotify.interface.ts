export interface SpotifyTrack {
	name: string
	artist: string
	album: string
}

export interface SpotifyPlaylistTracksResponse {
	total: number
	items: {
		item?: {
			type?: string
			name: string
			artists: { name: string }[]
			album: { name: string }
		} | null
		track?: {
			type?: string
			name: string
			artists: { name: string }[]
			album: { name: string }
		} | null
	}[]
	next: string | null
}

export interface SpotifyTokenResponse {
	access_token: string
	token_type: string
	expires_in: number
	refresh_token?: string
}

export interface SpotifyUserResponse {
	id?: string | null
	display_name?: string | null
	country?: string | null
}

export interface SpotifyPlaylistResponse {
	id: string
	name: string
	public: boolean | null
	owner: {
		id: string
		display_name?: string | null
	}
}
