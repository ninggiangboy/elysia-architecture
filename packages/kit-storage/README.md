# @kit/storage

## Purpose

The `ObjectStorage` port with an S3 adapter and a local-disk adapter that serves its own signed links, so an app can start without an S3 service.

## Install

```bash
bun add @kit/storage
```

Inside this repository it is a workspace package; outside, a build in `dist/` is what you get (`bun run build`).

## Ports

Defines `ObjectStorage`. Implements it with `S3ObjectStorage` and `LocalFsObjectStorage`; `createObjectStorage(config)` picks one from `STORAGE_DRIVER`. `@kit/storage/http` exports the routes behind the local links.

## Configuration

<!-- config:start -->
_Generated from the config slice by `bun scripts/package-docs.ts`; the reference app's `.env.example` lists the same variables._

| Variable | Default | Description |
| --- | --- | --- |
| `STORAGE_DRIVER` | `s3` | Where files live: `s3` (any S3-compatible service) or `local` (the disk of the API server). |
| `S3_ENDPOINT` | unset | s3: endpoint the API talks to. |
| `S3_PUBLIC_ENDPOINT` | unset | s3: endpoint browsers use for presigned links, when it differs from S3_ENDPOINT. |
| `S3_REGION` | `us-east-1` | s3: region. |
| `S3_BUCKET` | unset | s3: bucket for avatars, covers and data exports. |
| `S3_ACCESS_KEY_ID` | unset | s3: access key id. |
| `S3_SECRET_ACCESS_KEY` | unset | s3: secret access key. |
| `STORAGE_LOCAL_DIR` | `./.data/storage` | local: folder the files are written to. |
| `STORAGE_LOCAL_SECRET` | unset | local: key that signs upload and download links (32+ chars). Changing it invalidates links already handed out. |
| `STORAGE_LOCAL_PUBLIC_URL` | `http://localhost:3000/api` | local: where browsers reach the API (links look like `<this>/storage/local/<key>?…`). |
<!-- config:end -->

## Tables and migrations

None.

## Wiring

```ts
import { createObjectStorage } from '@kit/storage'
import { localStoragePlugin } from '@kit/storage/http'

const storage = createObjectStorage(config.storage)
app.use(localStoragePlugin(storage)) // answers 404 unless the driver is local
```

## Guarantees

Both adapters pass the same contract suite. Local links are HMAC-signed, expire, and an upload must declare the content type it was granted.

## Limits

The local disk is for one API server: several servers would each see their own files.

## Related

[Presigned upload, then verify](../../docs/patterns/presigned-upload-then-verify.md)
