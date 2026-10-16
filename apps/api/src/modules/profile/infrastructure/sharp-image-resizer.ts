import sharp from 'sharp'
import { AVATAR_THUMBNAIL_CONTENT_TYPE } from '../application/avatar-thumbnails'
import { type ImageResizer, UnprocessableImageError } from '../application/ports'

/** A 2 MB PNG can still declare a gigantic canvas; refuse to decode past ~25 megapixels. */
const MAX_INPUT_PIXELS = 25_000_000

export class SharpImageResizer implements ImageResizer {
  async square(source: Uint8Array, size: number) {
    try {
      const data = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
        .rotate() // honour EXIF orientation, which the re-encode drops
        .resize(size, size, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer()
      return { data, contentType: AVATAR_THUMBNAIL_CONTENT_TYPE }
    } catch (err) {
      throw new UnprocessableImageError(err)
    }
  }
}
