import { HttpClient } from '@angular/common/http'
import { ChangeDetectorRef, Component, ElementRef, ViewChild } from '@angular/core'

import { Instrument } from 'scan-chart'
import { firstValueFrom } from 'rxjs'
import { SearchService } from 'src-angular/app/core/services/search.service'
import { SpotifyService } from 'src-angular/app/core/services/spotify.service'
import { environment } from 'src-angular/environments/environment'
import { ChartData, SearchResult } from 'src-shared/interfaces/search.interface'
import { SpotifyTrack } from 'src-shared/interfaces/spotify.interface'
import { filterChartsByInstruments, instrumentDisplay, instruments } from 'src-shared/UtilFunctions'

export interface PlaylistTrackItem {
	track: SpotifyTrack
	status: 'pending' | 'searching' | 'found' | 'not_found' | 'error' | 'queued'
	charts: Pick<ChartData, 'name' | 'artist' | 'charter' | 'md5' | 'hasVideoBackground'>[]
	selectedChartIndex: number
}

@Component({
	selector: 'app-spotify-playlist-modal',
	templateUrl: './spotify-playlist-modal.component.html',
	standalone: false,
})
export class SpotifyPlaylistModalComponent {

	@ViewChild('modal', { static: false }) modal: ElementRef<HTMLDialogElement>

	public playlistUrl = ''
	public tracks: PlaylistTrackItem[] = []
	public isLoading = false
	public isSearching = false
	public errorMessage = ''
	public searchProgress = { current: 0, total: 0 }
	public instruments = instruments
	public instrumentDisplay = instrumentDisplay
	public selectedInstruments: (Instrument | null)[] = [null]
	public showInstrumentDropdown = false

	constructor(
		private http: HttpClient,
		private searchService: SearchService,
		private spotifyService: SpotifyService,
		private ref: ChangeDetectorRef,
	) { }

	open() {
		this.selectedInstruments = this.searchService.instruments.value
		this.modal.nativeElement.showModal()
	}

	close() {
		this.modal.nativeElement.close()
	}

	extractPlaylistId(): string | null {
		return this.spotifyService.extractPlaylistId(this.playlistUrl)
	}

	async fetchTracks() {
		this.errorMessage = ''
		this.tracks = []
		this.searchProgress = { current: 0, total: 0 }
		const playlistId = this.extractPlaylistId()

		if (!playlistId) {
			this.errorMessage = 'Invalid Spotify playlist URL. Expected format: https://open.spotify.com/playlist/...'
			return
		}

		this.isLoading = true
		this.detectChanges()
		try {
			const tracks = await this.spotifyService.fetchPlaylistTracks(playlistId)
			if (tracks.length === 0) {
				this.errorMessage = 'Spotify returned 0 playable tracks for this playlist.'
				return
			}

			this.tracks = tracks.map(track => ({
				track,
				status: 'pending' as const,
				charts: [],
				selectedChartIndex: 0,
			}))
			this.detectChanges()
			await new Promise(resolve => setTimeout(resolve, 0))
			void this.searchAll().catch(() => {
				this.errorMessage = 'Bulk search failed unexpectedly.'
				this.isSearching = false
				this.detectChanges()
			})
		} catch (err: any) {
			this.errorMessage = err.message ?? 'Failed to fetch playlist tracks.'
			if (err.message?.includes('401')) {
				this.errorMessage = 'Spotify authentication failed. Please check your Client ID and Secret in Settings.'
			} else if (err.message?.includes('403')) {
				this.errorMessage = err.message
			} else if (err.message?.includes('required') || err.message?.includes('Client ID')) {
				this.errorMessage = 'Spotify Client ID and Client Secret are required. Please set them in Settings.'
			}
		} finally {
			this.isLoading = false
			this.detectChanges()
		}
	}

	toggleInstrument(instrument: Instrument | null) {
		if (instrument === null) {
			this.selectedInstruments = [null]
		} else {
			const filtered = this.selectedInstruments.filter(i => i !== null)
			if (filtered.includes(instrument)) {
				const without = filtered.filter(i => i !== instrument)
				this.selectedInstruments = without.length ? without : [null]
			} else {
				this.selectedInstruments = [...filtered, instrument]
			}
		}
		this.searchService.instruments.setValue(this.selectedInstruments)
		this.restartSearchWithSelectedInstruments()
	}

	isInstrumentSelected(instrument: Instrument | null): boolean {
		return this.selectedInstruments.includes(instrument)
	}

	get selectedInstrumentsLabel(): string {
		if (this.selectedInstruments.includes(null) || this.selectedInstruments.length === 0) {
			return 'Any Instrument'
		}
		if (this.selectedInstruments.length === 1) {
			return instrumentDisplay(this.selectedInstruments[0])
		}
		return `${this.selectedInstruments.length} Instruments`
	}

	get canSearch(): boolean {
		return this.tracks.length > 0 && !this.isLoading && !this.isSearching
	}

	get canDownload(): boolean {
		return this.tracks.some(t => t.status === 'found')
	}

	get foundCount(): number {
		return this.tracks.filter(t => t.status === 'found').length
	}

	get notFoundCount(): number {
		return this.tracks.filter(t => t.status === 'not_found').length
	}

	async searchAll() {
		if (this.isSearching || this.tracks.length === 0) {
			return
		}

		this.isSearching = true
		this.errorMessage = ''
		this.searchProgress = { current: 0, total: this.tracks.length }
		this.detectChanges()

		try {
			for (let i = 0; i < this.tracks.length; i++) {
				const item = this.tracks[i]
				item.status = 'searching'
				this.searchProgress.current = i + 1
				this.detectChanges()

				try {
					// We need to call the search API directly. Since SearchService is tightly coupled
					// to UI state, we use the HttpClient directly here for bulk search.
					const results = await this.searchTrack(item.track)

					if (results.length > 0) {
						item.charts = results.map(r => ({
							name: r.name,
							artist: r.artist,
							charter: r.charter,
							md5: r.md5,
							hasVideoBackground: r.hasVideoBackground,
						}))
						item.selectedChartIndex = 0
						item.status = 'found'
					} else {
						item.status = 'not_found'
					}
				} catch {
					item.status = 'error'
				}
				this.detectChanges()
			}
		} finally {
			this.isSearching = false
			this.detectChanges()
		}
	}

	private async searchTrack(track: SpotifyTrack): Promise<ChartData[]> {
		return this.searchTrackWithInstrument(track, null)
	}

	private async searchTrackWithInstrument(track: SpotifyTrack, instrument: Instrument | null): Promise<ChartData[]> {
		const data = await firstValueFrom(this.http.post<SearchResult>(`${environment.apiUrl}/search`, {
			search: `${track.artist} ${track.name}`,
			per_page: 50,
			page: 1,
			instrument,
			difficulty: null,
			drumType: null,
			drumsReviewed: true,
			sort: null,
			source: 'bridge',
		}))
		return this.filterChartsByTrackAndInstruments(data.data ?? [], track)
	}

	private filterChartsByTrackAndInstruments(charts: ChartData[], track: SpotifyTrack) {
		const instrumentMatches = this.filterChartsBySelectedInstruments(charts)
		const exactTitleMatches = instrumentMatches.filter(chart => this.normalizeSearchText(chart.name) === this.normalizeSearchText(track.name))
		const usableMatches = exactTitleMatches.length > 0
			? exactTitleMatches
			: instrumentMatches

		return usableMatches
			.sort((a, b) => this.trackMatchScore(b, track) - this.trackMatchScore(a, track))
			.slice(0, 5)
	}

	private filterChartsBySelectedInstruments(charts: ChartData[]) {
		return filterChartsByInstruments(charts, this.selectedInstruments)
	}

	private normalizeSearchText(text: string | null) {
		return (text ?? '')
			.toLowerCase()
			.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
			.replace(/&/g, ' and ')
			.replace(/[^a-z0-9]+/g, ' ')
			.trim()
	}

	private isLikelySameTitle(chartName: string | null, spotifyName: string) {
		const chartTitle = this.normalizeSearchText(chartName)
		const spotifyTitle = this.normalizeSearchText(spotifyName)
		return chartTitle.length > 0 && spotifyTitle.length > 0 && (chartTitle.includes(spotifyTitle) || spotifyTitle.includes(chartTitle))
	}

	private trackMatchScore(chart: ChartData, track: SpotifyTrack) {
		let score = 0
		if (this.normalizeSearchText(chart.name) === this.normalizeSearchText(track.name)) {
			score += 10
		}
		if (this.normalizeSearchText(chart.artist) === this.normalizeSearchText(track.artist)) {
			score += 5
		}
		if (this.isLikelySameTitle(chart.name, track.name)) {
			score += 2
		}
		if (this.normalizeSearchText(chart.artist).includes(this.normalizeSearchText(track.artist))) {
			score += 1
		}
		return score
	}

	private restartSearchWithSelectedInstruments() {
		if (this.tracks.length === 0 || this.isLoading || this.isSearching) {
			return
		}

		for (const item of this.tracks) {
			item.status = 'pending'
			item.charts = []
			item.selectedChartIndex = 0
		}
		this.searchProgress = { current: 0, total: 0 }
		this.detectChanges()
		void this.searchAll()
	}

	downloadAll() {
		for (const item of this.tracks) {
			if (item.status === 'found' && item.charts.length > 0) {
				const chart = item.charts[item.selectedChartIndex]
				window.electron.emit.download({
					action: 'add',
					md5: chart.md5,
					hasVideoBackground: chart.hasVideoBackground,
					chart: {
						name: chart.name ?? 'Unknown Name',
						artist: chart.artist ?? 'Unknown Artist',
						album: 'Unknown Album',
						genre: 'Unknown Genre',
						year: 'Unknown Year',
						charter: chart.charter ?? 'Unknown Charter',
					},
				})
				item.status = 'queued'
			}
		}
	}

	clear() {
		this.playlistUrl = ''
		this.tracks = []
		this.isSearching = false
		this.errorMessage = ''
		this.searchProgress = { current: 0, total: 0 }
		this.selectedInstruments = [null]
		this.detectChanges()
	}

	private detectChanges() {
		// The modal mixes async fetches and direct property updates, so force a refresh after state changes.
		// This keeps the progress and result rows visible even if the zone doesn't pick up every await boundary.
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		queueMicrotask(() => this.ref.detectChanges())
	}
}
