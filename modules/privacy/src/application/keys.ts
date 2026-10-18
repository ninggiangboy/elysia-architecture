/** Everything privacy puts in the bucket lives under `exports/<userId>/`, so erasing the user is one prefix. */
export const exportsPrefix = (userId: string) => `exports/${userId}/`

/** One export's folder: the parts the modules write, then the archive built from them. */
export const exportFolder = (userId: string, exportId: string) =>
  `${exportsPrefix(userId)}${exportId}/`

/** Where each participating module writes its part (`<prefix><module>.json`). */
export const exportPartsPrefix = (userId: string, exportId: string) =>
  `${exportFolder(userId, exportId)}parts/`

export const exportArchiveKey = (userId: string, exportId: string) =>
  `${exportFolder(userId, exportId)}archive.zip`
