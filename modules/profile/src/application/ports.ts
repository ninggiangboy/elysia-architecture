/** The source bytes are not a decodable image (corrupt, unsupported, or absurdly large) — retrying cannot help. */
export class UnprocessableImageError extends Error {
  constructor(cause?: unknown) {
    super('Image cannot be processed', { cause })
    this.name = 'UnprocessableImageError'
  }
}

export interface ImageResizer {
  /** A square, cover-cropped `size`×`size` copy of the image; throws UnprocessableImageError for a bad source. */
  square(source: Uint8Array, size: number): Promise<{ data: Uint8Array; contentType: string }>
}
