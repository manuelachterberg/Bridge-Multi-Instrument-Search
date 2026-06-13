import { HttpClient } from '@angular/common/http'
import { EventEmitter, Injectable } from '@angular/core'
import { FormControl } from '@angular/forms'

import _ from 'lodash'
import { catchError, forkJoin, map, mergeMap, tap, throwError, timer } from 'rxjs'
import { Difficulty, Instrument } from 'scan-chart'
import { environment } from 'src-angular/environments/environment'
import { AdvancedSearch, ChartData, SearchResult } from 'src-shared/interfaces/search.interface'
import { DrumTypeName, filterChartsByInstruments, intersectChartResultsByInstruments } from 'src-shared/UtilFunctions'

const resultsPerPage = 25

@Injectable({
	providedIn: 'root',
})
export class SearchService {

	public searchLoading = false
	public songsResponse: Partial<SearchResult>
	public currentPage = 1
	public newSearch = new EventEmitter<Partial<SearchResult>>()
	public updateSearch = new EventEmitter<Partial<SearchResult>>()
	public isDefaultSearch = true
	public isAdvancedSearch = false
	public lastAdvancedSearch: AdvancedSearch

	public groupedSongs: ChartData[][]

	public availableIcons: string[]

	public searchControl = new FormControl('', { nonNullable: true })
	public instruments: FormControl<(Instrument | null)[]>
	public instrument = new FormControl<Instrument | null>(null)
	public difficulty: FormControl<Difficulty | null>
	public drumType: FormControl<DrumTypeName | null>
	public drumsReviewed: FormControl<boolean>
	public sortDirection: 'asc' | 'desc' = 'asc'
	public sortColumn: 'name' | 'artist' | 'album' | 'genre' | 'year' | 'charter' | 'length' | 'modifiedTime' | null = null

	constructor(
		private http: HttpClient,
	) {
		// For backward compatibility - read old single instrument setting
		const savedInstrument = localStorage.getItem('instrument');
		let initialInstruments: (Instrument | null)[] = [null];
		
		if (savedInstrument && savedInstrument !== 'null') {
			initialInstruments = [savedInstrument as Instrument];
		}
		
		// Try to read the new instruments array if it exists
		const savedInstruments = localStorage.getItem('instruments');
		if (savedInstruments) {
			try {
				initialInstruments = JSON.parse(savedInstruments) as (Instrument | null)[];
				if (!Array.isArray(initialInstruments) || initialInstruments.length === 0) {
					initialInstruments = [null];
				}
			} catch (e) {
				initialInstruments = [null];
			}
		}
		
		this.instruments = new FormControl<(Instrument | null)[]>(initialInstruments, { nonNullable: true });
		this.instrument.setValue(initialInstruments.find(instrument => instrument !== null) ?? null, { emitEvent: false })
		this.instruments.valueChanges.subscribe(instruments => {
			localStorage.setItem('instruments', JSON.stringify(instruments));
			this.instrument.setValue(instruments.find(instrument => instrument !== null) ?? null, { emitEvent: false })
			if (this.songsResponse.page) {
				this.search(this.searchControl.value || '*').subscribe();
			}
		});

		this.difficulty = new FormControl<Difficulty>(
			(localStorage.getItem('difficulty') === 'null' ? null : localStorage.getItem('difficulty')) as Difficulty
		)
		this.difficulty.valueChanges.subscribe(difficulty => {
			localStorage.setItem('difficulty', `${difficulty}`)
			if (this.songsResponse.page) {
				this.search(this.searchControl.value || '*').subscribe()
			}
		})

		this.drumType = new FormControl<DrumTypeName>(
			(localStorage.getItem('drumType') === 'null' ? null : localStorage.getItem('drumType')) as DrumTypeName
		)
		this.drumType.valueChanges.subscribe(drumType => {
			localStorage.setItem('drumType', `${drumType}`)
			if (this.songsResponse.page) {
				this.search(this.searchControl.value || '*').subscribe()
			}
		})

		this.drumsReviewed = new FormControl<boolean>((localStorage.getItem('drumsReviewed') ?? 'true') === 'true', { nonNullable: true })
		this.drumsReviewed.valueChanges.subscribe(drumsReviewed => {
			localStorage.setItem('drumsReviewed', `${drumsReviewed}`)
			if (this.songsResponse?.page) {
				this.search(this.searchControl.value || '*').subscribe()
			}
		})

		this.http.get<{ "name": string; "sha1": string }[]>('https://clonehero.gitlab.io/sources/icons.json').subscribe(result => {
			this.availableIcons = result.map(r => r.name)
		})

		this.search().subscribe()
	}

	get areMorePages() { return this.songsResponse?.page && this.groupedSongs.length === this.songsResponse.page * resultsPerPage }

	/**
	 * General search, uses the `/search?q=` endpoint.
	 *
	 * If fetching the next page, set `nextPage=true` to incremement the page count in the search.
	 *
	 * Leave the search term blank to fetch the songs with charts most recently added.
	 */
	public search(search = '*', nextPage = false) {
		this.searchLoading = true;
		this.isDefaultSearch = search === '*';
		this.isAdvancedSearch = false;

		if (nextPage) {
			this.currentPage++;
		} else {
			this.currentPage = 1;
		}

		const selectedInstruments = this.instruments.value || [null];

		// If "Any" is selected or the array is empty, just do a normal search with null instrument
		if (selectedInstruments.includes(null) || selectedInstruments.length === 0) {
			return this.searchWithInstrument(search, null, nextPage);
		}

		// If there's only one instrument selected, use it directly
		if (selectedInstruments.length === 1) {
			return this.searchWithInstrument(search, selectedInstruments[0], nextPage);
		}

		// For multiple instruments, we need to perform multiple searches and combine results
		const searches = selectedInstruments.map(instrument => {
			return this.searchWithInstrument(search, instrument, nextPage, true);
		});

		return forkJoin(searches).pipe(
			map((results: SearchResult[]) => {
				const concreteInstruments = selectedInstruments.filter((instrument): instrument is Instrument => instrument !== null)
				const uniqueData = intersectChartResultsByInstruments(results.map(result => result.data), concreteInstruments)

				// Create a combined result
				const combinedResult: SearchResult = {
					data: uniqueData,
					found: uniqueData.length,
					page: this.currentPage,
					out_of: uniqueData.length,
					search_time_ms: results.reduce((sum, result) => sum + result.search_time_ms, 0),
				};

				// Process the combined result
				this.searchLoading = false;

				if (!nextPage) {
					this.groupedSongs = [];
				}

				this.songsResponse = combinedResult;

				this.groupedSongs.push(
					..._.chain(combinedResult.data)
						.groupBy(c => c.songId ?? -1 * c.chartId)
						.values()
						.value()
				);

				if (nextPage) {
					this.updateSearch.emit(combinedResult);
				} else {
					this.newSearch.emit(combinedResult);
				}

				return combinedResult;
			})
		);
	}

	/**
	 * Helper method to search with a specific instrument
	 */
	private searchWithInstrument(search = '*', instrument: Instrument | null, nextPage = false, internal = false) {
		let retries = 10;
		return this.http.post<SearchResult>(`${environment.apiUrl}/search`, {
			search,
			per_page: resultsPerPage,
			page: this.currentPage,
			instrument: instrument,
			difficulty: this.difficulty.value,
			drumType: this.drumType.value,
			drumsReviewed: this.drumsReviewed.value,
			sort: this.sortColumn !== null ? { type: this.sortColumn, direction: this.sortDirection } : null,
			source: 'bridge',
		}).pipe(
			map(response => ({
				...response,
				data: filterChartsByInstruments(response.data, instrument === null ? [null] : [instrument]),
			})),
			catchError((err, caught) => {
				if (err.status === 400 || retries-- <= 0) {
					this.searchLoading = false;
					console.log(err);
					return throwError(() => err);
				} else {
					return timer(2000).pipe(mergeMap(() => caught));
				}
			}),
			tap(response => {
				// Only update the UI state if this is not an internal call (part of a multi-instrument search)
				if (!internal) {
					this.searchLoading = false;

					if (!nextPage) {
						// Don't reload results if they are the same
						if (
							this.groupedSongs &&
							_.xorBy(this.songsResponse!.data, response.data, r => r.chartId).length === 0 &&
							this.songsResponse!.found === response.found
						) {
							return;
						} else {
							this.groupedSongs = [];
						}
					}
					
					this.songsResponse = response;

					this.groupedSongs.push(
						..._.chain(response.data)
							.groupBy(c => c.songId ?? -1 * c.chartId)
							.values()
							.value()
					);

					if (nextPage) {
						this.updateSearch.emit(response);
					} else {
						this.newSearch.emit(response);
					}
				}
			})
		);
	}

	public advancedSearch(search: AdvancedSearch, nextPage = false) {
		this.searchLoading = true;
		this.isDefaultSearch = false;
		this.isAdvancedSearch = true;
		this.lastAdvancedSearch = search;

		if (nextPage) {
			this.currentPage++;
		} else {
			this.currentPage = 1;
		}

		const selectedInstruments = search.instruments || [null];
		
		// If "Any" is selected or the array is empty, just do a normal search with null instrument
		if (selectedInstruments.includes(null) || selectedInstruments.length === 0) {
			const modifiedSearch = { ...search, instrument: null };
			delete modifiedSearch.instruments;
			return this.advancedSearchWithInstrument(modifiedSearch, nextPage);
		}

		// If there's only one instrument selected, use it directly
		if (selectedInstruments.length === 1) {
			const modifiedSearch = { ...search, instrument: selectedInstruments[0] };
			delete modifiedSearch.instruments;
			return this.advancedSearchWithInstrument(modifiedSearch, nextPage);
		}

		// For multiple instruments, we need to perform multiple searches and combine results
		const searches = selectedInstruments.map(instrument => {
			const modifiedSearch = { ...search, instrument };
			delete modifiedSearch.instruments;
			return this.advancedSearchWithInstrument(modifiedSearch, nextPage, true);
		});

		return forkJoin(searches).pipe(
			map((results: { data: SearchResult['data']; found: number }[]) => {
				const concreteInstruments = selectedInstruments.filter((instrument): instrument is Instrument => instrument !== null)
				const uniqueData = intersectChartResultsByInstruments(results.map(result => result.data), concreteInstruments)

				// Create a combined result
				const combinedResult = {
					data: uniqueData,
					found: uniqueData.length
				};

				// Process the combined result
				this.searchLoading = false;

				if (!nextPage) {
					this.groupedSongs = [];
				}

				this.songsResponse = {
					...combinedResult,
					page: this.currentPage,
				};

				this.groupedSongs.push(
					..._.chain(combinedResult.data)
						.groupBy(c => c.songId ?? -1 * c.chartId)
						.values()
						.value()
				);

				if (nextPage) {
					this.updateSearch.emit(combinedResult);
				} else {
					this.newSearch.emit(combinedResult);
				}

				return combinedResult;
			})
		);
	}

	/**
	 * Helper method to perform advanced search with a specific instrument
	 */
	private advancedSearchWithInstrument(search: AdvancedSearch, nextPage = false, internal = false) {
		let retries = 10;
		return this.http.post<{ data: SearchResult['data']; found: number }>(`${environment.apiUrl}/search/advanced`, {
			per_page: resultsPerPage,
			page: this.currentPage,
			...search,
		}).pipe(
			map(response => ({
				...response,
				data: filterChartsByInstruments(response.data, search.instrument === null ? [null] : [search.instrument as Instrument]),
			})),
			catchError((err, caught) => {
				if (err.status === 400 || retries-- <= 0) {
					this.searchLoading = false;
					console.log(err);
					return throwError(() => err);
				} else {
					return timer(2000).pipe(mergeMap(() => caught));
				}
			}),
			tap(response => {
				// Only update the UI state if this is not an internal call (part of a multi-instrument search)
				if (!internal) {
					this.searchLoading = false;

					if (!nextPage) {
						// Don't reload results if they are the same
						if (
							this.groupedSongs &&
							_.xorBy(this.songsResponse!.data, response.data, r => r.chartId).length === 0 &&
							this.songsResponse!.found === response.found
						) {
							return;
						} else {
							this.groupedSongs = [];
						}
					}

					this.songsResponse = response;

					this.groupedSongs.push(
						..._.chain(response.data)
							.groupBy(c => c.songId ?? -1 * c.chartId)
							.values()
							.value()
					);

					if (nextPage) {
						this.updateSearch.emit(response);
					} else {
						this.newSearch.emit(response);
					}
				}
			})
		);
	}

	public getNextSearchPage() {
		if (this.areMorePages && !this.searchLoading) {
			if (this.isAdvancedSearch) {
				this.advancedSearch(this.lastAdvancedSearch, true).subscribe()
			} else {
				this.search(this.searchControl.value || '*', true).subscribe()
			}
		}
	}

	public reloadSearch() {
		if (this.isAdvancedSearch) {
			this.lastAdvancedSearch.sort = this.sortColumn !== null ? { type: this.sortColumn, direction: this.sortDirection } : null
			this.advancedSearch(this.lastAdvancedSearch, false).subscribe()
		} else {
			this.search(this.searchControl.value || '*', false).subscribe()
		}
	}
}
