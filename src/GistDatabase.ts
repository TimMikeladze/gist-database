import crypto from 'crypto'
import isPlainObject from 'is-plain-obj'
import fetch from 'node-fetch'
import { getGistApi } from './gistApi'
import { compress, decompress } from 'compress-json'

export interface GistDatabaseOptions {
  description?: string
  gistId?: string
  public?: boolean
  token: string
}

export type GistResponse = {
  files: Record<
    string,
    {
      content: string
    }
  >
  id: string
  url: string
}

export type Doc = {
  gist: {
    [key: string]: any
    id: string
  }
  id: string
  value: any
}

export type DocRef = {
  id: string
  ttl: {
    createdAt: number
    ttl: number
  }
}

export const defaultOptions: Partial<GistDatabaseOptions> = {
  public: false
}

export class GistDatabase {
  private readonly options: GistDatabaseOptions
  public readonly gistApi: ReturnType<typeof getGistApi>
  public isNewDatabase: boolean

  constructor(options: GistDatabaseOptions) {
    this.options = {
      ...defaultOptions,
      ...options
    }
    this.gistApi = getGistApi({
      token: this.options.token
    })
  }

  public static createDatabaseRoot(
    options: GistDatabaseOptions
  ): Promise<GistResponse> {
    const gistApi = getGistApi({
      token: options.token
    })

    return gistApi('/gists', 'POST', {
      description: options.description,
      public: options.public,
      files: {
        'database.json': {
          content: JSON.stringify({})
        }
      }
    }) as Promise<GistResponse>
  }

  public async init() {
    let gist
    if (!this.options.gistId) {
      gist = await GistDatabase.createDatabaseRoot(this.options)
      this.options.gistId = gist.id
      this.isNewDatabase = true
    } else {
      gist = await this.getRoot()
      if (!gist) {
        throw new Error('gist not found')
      }
      this.isNewDatabase = false
      this.options.gistId = gist.id
    }
    return gist
  }

  public async getRoot(): Promise<GistResponse> {
    return (await this.gistApi(
      `/gists/${this.options.gistId}`,
      'GET'
    )) as GistResponse
  }

  public async get(key: string | string[]): Promise<Doc> {
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = JSON.parse(root.files['database.json'].content)

    const found: DocRef = GistDatabase.get(database, path)

    if (!found) {
      return undefined
    }

    if (found.ttl.ttl && GistDatabase.ttlIsExpired(found.ttl)) {
      await this.gistApi(`/gists/${found.id}`, 'DELETE')
      return undefined
    }

    const gist = (await this.gistApi(
      `/gists/${found.id}`,
      'GET'
    )) as GistResponse

    if (!gist) {
      return undefined
    }

    const value = gist.files?.[GistDatabase.formatPath(path)]
      ? JSON.parse(gist.files?.[GistDatabase.formatPath(path)].content)
      : null

    if (!value) {
      return undefined
    }

    const ttl = JSON.parse(gist.files['ttl.json'].content)

    if (ttl.ttl && GistDatabase.ttlIsExpired(ttl)) {
      await this.gistApi(`/gists/${found.id}`, 'DELETE')
      return undefined
    }

    return {
      gist,
      id: found.id,
      value
    }
  }

  public getMany(keys: string[]): Promise<Doc[]> {
    return Promise.all(keys.map((key) => this.get(key)))
  }

  public async has(key: string | string[]): Promise<boolean> {
    return (await this.get(key)) !== undefined
  }

  public async set(
    key: string | string[],
    value: any,
    ttl?: number,
    description?: string
  ): Promise<Doc> {
    if (!isPlainObject(value)) {
      throw new Error('value must be a plain javascript object')
    }
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = JSON.parse(root.files['database.json'].content)

    const id = GistDatabase.get(database, path)

    let gist: GistResponse

    if (id) {
      gist = (await this.gistApi(`/gists/${id}`, 'PATCH', {
        description,
        files: {
          [GistDatabase.formatPath(path)]: {
            content: JSON.stringify(value)
          },
          'ttl.json': {
            content: JSON.stringify({
              createdAt: Date.now(),
              ttl
            })
          }
        }
      })) as GistResponse
    } else {
      gist = (await this.gistApi('/gists', 'POST', {
        description,
        public: this.options.public,
        files: {
          [GistDatabase.formatPath(path)]: {
            content: JSON.stringify(value)
          },
          'ttl.json': {
            content: JSON.stringify({
              createdAt: Date.now(),
              ttl
            })
          }
        }
      })) as GistResponse
    }

    if (!id || ttl) {
      const newDatabase = GistDatabase.set(database, path, {
        id: gist.id,
        ttl: {
          ...GistDatabase.get(database, [...path, 'ttl']),
          ttl
        }
      })

      await this.gistApi(`/gists/${this.options.gistId}`, 'PATCH', {
        files: {
          'database.json': {
            content: JSON.stringify(newDatabase)
          }
        }
      })
    }

    return {
      value,
      gist,
      id: gist.id
    }
  }

  public async delete(key: string | string[]) {
    const path = Array.isArray(key) ? key : [key]
    const root = await this.getRoot()
    const database = JSON.parse(root.files['database.json'].content)
    const found: DocRef = GistDatabase.get(database, path)

    if (!found) {
      return undefined
    }

    await this.gistApi(`/gists/${found.id}`, 'DELETE')

    const newDatabase = GistDatabase.del(database, path)

    await this.gistApi(`/gists/${this.options.gistId}`, 'PATCH', {
      files: {
        'database.json': {
          content: JSON.stringify(newDatabase)
        }
      }
    })
  }

  public async deleteMany(keys: string[]) {
    return Promise.all(keys.map((key) => this.delete(key)))
  }

  public async destroy() {
    const root = await this.getRoot()
    const database = JSON.parse(root.files['database.json'].content)

    await Promise.allSettled(
      Object.keys(database).map(async (key) => {
        await this.gistApi(`/gists/${database[key].id}`, 'DELETE')
      })
    )

    await this.gistApi(`/gists/${this.options.gistId}`, 'DELETE')
  }

  public static get(obj: any, path: string[]) {
    if (path.length === 0) {
      return obj
    }
    const [key, ...rest] = path
    if (obj[key] === undefined) {
      return undefined
    }
    return GistDatabase.get(obj[key], rest)
  }

  public static set(obj: any, path: string[], value: any) {
    if (path.length === 0) {
      return value
    }
    const [key, ...rest] = path
    return {
      ...obj,
      [key]: GistDatabase.set(obj[key], rest, value)
    }
  }

  public static del(obj: any, path: string[]) {
    if (path.length === 0) {
      return undefined
    }
    const [key, ...rest] = path
    if (obj[key] === undefined) {
      return obj
    }
    return {
      ...obj,
      [key]: GistDatabase.del(obj[key], rest)
    }
  }

  public static ttlIsExpired(ttl: DocRef['ttl']) {
    return ttl.ttl && Date.now() - ttl.createdAt > ttl.ttl
  }

  public static formatPath(path: string[]) {
    return (Array.isArray(path) ? path.join('.') : path) + '.json'
  }

  public static toJSON(value: any) {
    return JSON.stringify(compress(value))
  }

  public static fromJSON(value: any) {
    return JSON.parse(decompress(value))
  }
}
// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb

const IV_LENGTH = 16 // For AES, this is always 16

const encrypt = (text: string, encryptionKey: string) => {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(encryptionKey),
    iv
  )
  let encrypted = cipher.update(text)

  encrypted = Buffer.concat([encrypted, cipher.final()])

  return iv.toString('hex') + ':' + encrypted.toString('hex')
}

const decrypt = (text: string, encryptionKey: string) => {
  const textParts = text.split(':')
  const iv = Buffer.from(textParts.shift(), 'hex')
  const encryptedText = Buffer.from(textParts.join(':'), 'hex')
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(encryptionKey),
    iv
  )
  let decrypted = decipher.update(encryptedText)

  decrypted = Buffer.concat([decrypted, decipher.final()])

  return decrypted.toString()
}
