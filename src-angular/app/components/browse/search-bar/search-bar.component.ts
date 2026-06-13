import { AfterViewInit, Component, ElementRef, OnInit, ViewChild } from '@angular/core'
import { AbstractControl, FormBuilder, FormControl } from '@angular/forms'

import dayjs from 'dayjs'
import { distinctUntilChanged, switchMap, throttleTime } from 'rxjs'
import { Difficulty, Instrument } from 'scan-chart'
import { SearchService } from 'src-angular/app/core/services/search.service'
import { SpotifyPlaylistModalComponent } from '../../spotify/spotify-playlist-modal.component'
import { difficulties, difficultyDisplay, drumsReviewedDisplay, drumTypeDisplay, DrumTypeName, drumTypeNames, instrumentDisplay, instruments } from 'src-shared/UtilFunctions'

@Component({
	selector: 'app-search-bar',
	templateUrl: './search-bar.component.html',
	standalone: false,
})
export class SearchBarComponent implements OnInit, AfterViewInit {

	@ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement>

	@ViewChild('hasSoloSections') hasSoloSections: ElementRef<HTMLInputElement>
	@ViewChild('hasForcedNotes') hasForcedNotes: ElementRef<HTMLInputElement>
	@ViewChild('hasOpenNotes') hasOpenNotes: ElementRef<HTMLInputElement>
	@ViewChild('hasTapNotes') hasTapNotes: ElementRef<HTMLInputElement>
	@ViewChild('hasRollLanes') hasRollLanes: ElementRef<HTMLInputElement>
	@ViewChild('has2xKick') has2xKick: ElementRef<HTMLInputElement>

	public showAdvanced = false
	public instruments = instruments
	public difficulties = difficulties
	public drumTypes = drumTypeNames
	public instrumentDisplay = instrumentDisplay
	public difficultyDisplay = difficultyDisplay
	public drumTypeDisplay = drumTypeDisplay
	public drumsReviewedDisplay = drumsReviewedDisplay

	public advancedSearchForm: ReturnType<this['getAdvancedSearchForm']>
	public startValidation = false

	constructor(
		private searchService: SearchService,
		private fb: FormBuilder,
	) { }

	ngOnInit() {
		this.searchControl.valueChanges.pipe(
			throttleTime(400, undefined, { leading: true, trailing: true }),
			distinctUntilChanged(),
			switchMap(search => this.searchService.search(search || '*'))
		).subscribe()

		this.initializeAdvancedSearchForm()
	}

	ngAfterViewInit() {
		this.searchInput.nativeElement.focus()
		this.updateDisabledControls()
		this.searchService.instruments.valueChanges.subscribe(() => {
			this.updateDisabledControls()
		})
	}

	setShowAdvanced(showAdvanced: boolean) {
		this.showAdvanced = showAdvanced
		if (showAdvanced) {
			this.startValidation = false
			this.searchControl.disable()
		} else {
			this.searchControl.enable()
		}
	}

	get searchControl() {
		return this.searchService.searchControl
	}

	get selectedInstruments() {
		return this.searchService.instruments.value
	}

	get searchLoading() {
		return this.searchService.searchLoading
	}

	toggleInstrument(instrument: Instrument | null, event: MouseEvent) {
		const currentInstruments = [...this.selectedInstruments]
		
		if (currentInstruments.includes(instrument)) {
			// Remove the instrument if already selected
			const newInstruments = currentInstruments.filter(i => i !== instrument)
			this.searchService.instruments.setValue(newInstruments.length ? newInstruments : [null])
		} else {
			// Add the instrument
			// Remove null/Any if it exists and we're adding a specific instrument
			let newInstruments: (Instrument | null)[] = instrument !== null ? 
				currentInstruments.filter(i => i !== null) : [null]
			
			// If we're adding "Any", clear other selections
			if (instrument === null) {
				newInstruments = [null]
			} else {
				newInstruments.push(instrument)
			}
			
			this.searchService.instruments.setValue(newInstruments)
		}
		
		if (event.target instanceof HTMLElement) {
			event.target.parentElement?.parentElement?.blur()
		}
	}

	isInstrumentSelected(instrument: Instrument | null): boolean {
		return this.selectedInstruments.includes(instrument)
	}

	get difficulty() {
		return this.searchService.difficulty.value
	}
	setDifficulty(difficulty: Difficulty | null, event: MouseEvent) {
		this.searchService.difficulty.setValue(difficulty)
		if (event.target instanceof HTMLElement) {
			event.target.parentElement?.parentElement?.blur()
		}
	}

	get drumType() {
		return this.searchService.drumType.value
	}
	setDrumType(drumType: DrumTypeName | null, event: MouseEvent) {
		this.searchService.drumType.setValue(drumType)
		if (event.target instanceof HTMLElement) {
			event.target.parentElement?.parentElement?.blur()
		}
	}

	get drumsReviewed() {
		return this.searchService.drumsReviewed.value
	}
	setDrumsReviewed(drumsReviewed: boolean, event: MouseEvent) {
		this.searchService.drumsReviewed.setValue(drumsReviewed)
		if (event.target instanceof HTMLElement) {
			event.target.parentElement?.parentElement?.blur()
		}
	}

	get todayDate() {
		return dayjs().format('YYYY-MM-DD')
	}

	initializeAdvancedSearchForm() {
		this.advancedSearchForm = this.getAdvancedSearchForm() as ReturnType<this['getAdvancedSearchForm']>

		for (const key of ['name', 'artist', 'album', 'genre', 'year', 'charter'] as const) {
			this.advancedSearchForm.get(key)?.get('exact')?.disable()
			this.advancedSearchForm.get(key)?.get('exclude')?.disable()
			this.advancedSearchForm.get(key)?.get('value')?.valueChanges.subscribe(value => {
				if (value) {
					this.advancedSearchForm.get(key)?.get('exact')?.enable()
					this.advancedSearchForm.get(key)?.get('exclude')?.enable()
				} else {
					this.advancedSearchForm.get(key)?.get('exact')?.disable()
					this.advancedSearchForm.get(key)?.get('exact')?.setValue(false)
					this.advancedSearchForm.get(key)?.get('exclude')?.disable()
					this.advancedSearchForm.get(key)?.get('exclude')?.setValue(false)
				}
			})
		}
	}

	updateDisabledControls() {
		const selectedInstruments = this.selectedInstruments
		const hasDrums = selectedInstruments.includes('drums')
		const hasNonDrums = selectedInstruments.some(i => i !== 'drums' && i !== null)
		const isAny = selectedInstruments.includes(null)
		const explanation = 'Not available for the current instrument selection.'

		// Enable drum controls if drums are selected
		this.hasRollLanes.nativeElement.disabled = !hasDrums && !isAny
		this.has2xKick.nativeElement.disabled = !hasDrums && !isAny
		
		// Enable non-drum controls if non-drum instruments are selected
		this.hasForcedNotes.nativeElement.disabled = !hasNonDrums && !isAny
		this.hasOpenNotes.nativeElement.disabled = !hasNonDrums && !isAny
		this.hasTapNotes.nativeElement.disabled = !hasNonDrums && !isAny
		
		// Set titles
		this.hasRollLanes.nativeElement.title = !hasDrums && !isAny ? explanation : ''
		this.has2xKick.nativeElement.title = !hasDrums && !isAny ? explanation : ''
		this.hasForcedNotes.nativeElement.title = !hasNonDrums && !isAny ? explanation : ''
		this.hasOpenNotes.nativeElement.title = !hasNonDrums && !isAny ? explanation : ''
		this.hasTapNotes.nativeElement.title = !hasNonDrums && !isAny ? explanation : ''
		
		// Reset values as needed
		if (!isAny) {
			if (!hasDrums) {
				this.advancedSearchForm.get('hasRollLanes')?.setValue(null)
				this.advancedSearchForm.get('has2xKick')?.setValue(null)
				this.hasRollLanes.nativeElement.indeterminate = true
				this.has2xKick.nativeElement.indeterminate = true
			}
			if (!hasNonDrums) {
				this.advancedSearchForm.get('hasForcedNotes')?.setValue(null)
				this.advancedSearchForm.get('hasOpenNotes')?.setValue(null)
				this.advancedSearchForm.get('hasTapNotes')?.setValue(null)
				this.hasForcedNotes.nativeElement.indeterminate = true
				this.hasOpenNotes.nativeElement.indeterminate = true
				this.hasTapNotes.nativeElement.indeterminate = true
			}
		}
	}

	getAdvancedSearchForm() {
		return this.fb.group({
			name: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			artist: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			album: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			genre: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			year: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			charter: this.fb.nonNullable.group({ value: '', exact: false, exclude: false }),
			minLength: null as number | null,
			maxLength: null as number | null,
			minIntensity: null as number | null,
			maxIntensity: null as number | null,
			minAverageNPS: null as number | null,
			maxAverageNPS: null as number | null,
			minMaxNPS: null as number | null,
			maxMaxNPS: null as number | null,
			minYear: null as number | null,
			maxYear: null as number | null,
			modifiedAfter: this.fb.nonNullable.control('', { validators: dateValidator }),
			hash: this.fb.nonNullable.control(''),
			trackHash: this.fb.nonNullable.control(''),
			hasSoloSections: null as boolean | null,
			hasForcedNotes: null as boolean | null,
			hasOpenNotes: null as boolean | null,
			hasTapNotes: null as boolean | null,
			hasLyrics: null as boolean | null,
			hasVocals: null as boolean | null,
			hasRollLanes: null as boolean | null,
			has2xKick: null as boolean | null,
			hasIssues: null as boolean | null,
			hasVideoBackground: null as boolean | null,
			modchart: null as boolean | null,
		})
	}

	clickCheckbox(key: string, event: MouseEvent) {
		if (event.target instanceof HTMLInputElement) {
			const control = this.advancedSearchForm.get(key) as FormControl<boolean | null>
			if (control.value === true) {
				control.setValue(false)
				event.target.checked = false
			} else if (control.value === false) {
				control.setValue(null)
				event.target.checked = false
				event.target.indeterminate = true
			} else if (control.value === null) {
				control.setValue(true)
				event.target.checked = true
				event.target.indeterminate = false
			}
		}
	}

	formValue(key: string) {
		return this.advancedSearchForm.get(key)?.value
	}

	searchAdvanced() {
		this.startValidation = true
		if (this.advancedSearchForm.valid && !this.searchService.searchLoading) {
			this.searchService.advancedSearch({
				instrument: this.selectedInstruments.includes(null) ? null : this.selectedInstruments.join(','),
				instruments: this.selectedInstruments,
				difficulty: this.difficulty,
				drumType: this.drumType,
				drumsReviewed: this.drumsReviewed,
				sort: this.searchService.sortColumn !== null ? { type: this.searchService.sortColumn, direction: this.searchService.sortDirection } : null,
				source: 'bridge' as const,
				...this.advancedSearchForm.getRawValue(),
			}).subscribe()
		}
	}
}

function dateValidator(control: AbstractControl) {
	if (control.value && isNaN(Date.parse(control.value))) {
		return { 'dateValidator': true }
	}
	return null
}
