import { zipSync } from 'fflate'
import type { ArchiveBuilder, ArchiveEntry } from '../application/ports'

/** Builds a .zip in memory — exports are bounded (a few JSON files and two images), so no streaming is needed. */
export class ZipArchiveBuilder implements ArchiveBuilder {
  build(entries: ArchiveEntry[], now: Date): Uint8Array {
    const files: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {}
    for (const { path, data } of entries) files[path] = [data, { level: 6, mtime: now }]
    return zipSync(files)
  }
}
