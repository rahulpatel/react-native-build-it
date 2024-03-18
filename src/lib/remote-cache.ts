import assert from "node:assert"
import { Storage, Bucket } from "@google-cloud/storage"
import AdmZip from "adm-zip"
import { basename } from "pathe"

import { config } from "./config"
import type { LocalCache } from "./local-cache"

class GCP {
  bucket: Bucket

  constructor() {
    assert(config?.gcp, "GCP is not configured")
    assert(config?.gcp.bucket, "GCP bucket is not configured")

    const storage = new Storage({
      keyFilename: config.gcp.keyFilename,
      projectId: config.gcp.projectId,
    })
    this.bucket = storage.bucket(config.gcp.bucket)
  }

  async exists(path: string) {
    const file = this.bucket.file(path)
    const [exists] = await file.exists()
    return exists
  }

  async upload(path: string, buffer: Buffer) {
    const file = this.bucket.file(path)
    await file.save(buffer)
  }

  async download(path: string) {
    const file = this.bucket.file(path)
    const [buffer] = await file.download()
    return buffer
  }
}

export class RemoteCache {
  localCache: LocalCache

  remote?: GCP
  enabled: boolean = false

  constructor(localCache: LocalCache) {
    this.localCache = localCache

    if (config?.gcp) {
      this.remote = new GCP()
      this.enabled = true
    } else {
      console.warn("Remote cache is not configured")
    }
  }

  remotePath() {
    return `${basename(this.localCache.path())}.zip`
  }

  async exists() {
    assert(this.remote, "Remote cache is not configured")
    return this.remote.exists(this.remotePath())
  }

  async upload(pathToZip: string) {
    assert(this.remote, "Remote cache is not configured")

    const zip = new AdmZip()
    zip.addLocalFolder(pathToZip)
    const buffer = zip.toBuffer()

    await this.remote.upload(this.remotePath(), buffer)
  }

  async download() {
    assert(this.remote, "Remote cache is not configured")

    const exists = await fs.exists(this.localCache.path())
    if (exists) {
      return
    }

    const existsOnRemote = await this.exists()
    if (!existsOnRemote) {
      return
    }

    const buffer = await this.remote.download(this.remotePath())
    const zip = new AdmZip(buffer)
    zip.extractAllTo(this.localCache.path(), true)
  }
}
