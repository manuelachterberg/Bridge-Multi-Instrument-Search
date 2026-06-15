import { cp, mkdir, readFile, rm, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'

export async function ensureDir(path: string) {
	await mkdir(path, { recursive: true })
}

export async function outputFile(path: string, data: string | Uint8Array, options?: BufferEncoding | { encoding?: BufferEncoding }) {
	await ensureDir(dirname(path))
	await writeFile(path, data, options)
}

export async function readJson<T>(path: string) {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function remove(path: string) {
	await rm(path, { recursive: true, force: true })
}

export async function move(source: string, destination: string, options: { overwrite?: boolean } = {}) {
	if (options.overwrite) {
		await remove(destination)
	}

	try {
		await rename(source, destination)
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
			await cp(source, destination, { recursive: true })
			await rm(source, { recursive: true, force: true })
			return
		}

		throw err
	}
}
