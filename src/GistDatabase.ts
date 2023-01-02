import isPlainObject from 'is-plain-obj'
import { getGistApi } from './gistApi'
import { Blob } from 'buffer'
import { pack, unpack } from 'msgpackr'

export enum CompressionType {
  msgpack = 'msgpack',
  none = 'none',
  pretty = 'pretty'
}

export interface GistDatabaseOptions {
  compression?: CompressionType
  description?: string
  id?: string
  public?: boolean
  token: string
}

export type GistResponse = {
  files: Record<
    string,
    {
      content: string
      size: number
    }
  >
  id: string
  url: string
}

export type Doc<T = any> = {
  gist: {
    [key: string]: any
    id: string
  }
  id: string
  value: T
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
  public static MAX_FILE_SIZE_BYTES = 1000000 // 1mb
  public static MAX_FILES_PER_GIST = 10
  public isNewDatabase: boolean
  public initialized: boolean = false

  constructor(options: GistDatabaseOptions) {
    this.options = {
      ...defaultOptions,
      ...options
    }
    this.gistApi = getGistApi({
      token: this.options.token
    })
  }

  public getDatabaseId() {
    return this.options.id
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
          content: GistDatabase.serialize({}, options.compression)
        }
      }
    }) as Promise<GistResponse>
  }

  public async init() {
    let gist
    if (!this.options.id) {
      gist = await GistDatabase.createDatabaseRoot(this.options)
      this.options.id = gist.id
      this.isNewDatabase = true
    } else {
      gist = await this.getRoot()
      if (!gist) {
        throw new Error('gist not found')
      }
      this.isNewDatabase = false
      this.options.id = gist.id
    }
    this.initialized = true
    return gist
  }

  private async initIfNeeded() {
    if (!this.initialized) {
      await this.init()
    }
  }

  public async keys(): Promise<string[]> {
    const root = await this.getRoot()
    const database = GistDatabase.deserialize(
      root.files['database.json'].content,
      this.options.compression
    )
    return Object.keys(database)
  }

  public async getRoot(): Promise<GistResponse> {
    await this.initIfNeeded()
    return (await this.gistApi(
      `/gists/${this.options.id}`,
      'GET'
    )) as GistResponse
  }

  public async get<T = any>(key: string | string[]): Promise<Doc<T>> {
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = GistDatabase.deserialize(
      root.files['database.json'].content,
      this.options.compression
    )

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

    if (!gist?.files || !Object.keys(gist.files).length) {
      return undefined
    }

    const data = GistDatabase.unpack(
      gist.files,
      this.options.compression
    ) as DocRef & Doc<T>

    if (!data) {
      return undefined
    }

    const ttl = data.ttl

    if (ttl.ttl && GistDatabase.ttlIsExpired(ttl)) {
      await this.gistApi(`/gists/${found.id}`, 'DELETE')
      return undefined
    }

    return {
      gist,
      id: found.id,
      value: data.value
    }
  }

  public getMany(keys: string[]): Promise<Doc[]> {
    return Promise.all(keys.map((key) => this.get(key)))
  }

  public async has(key: string | string[]): Promise<boolean> {
    return (await this.get(key)) !== undefined
  }

  public static unpack(files: GistResponse['files'], type: CompressionType) {
    const keys = Object.keys(files)
    if (!keys.length) {
      return undefined
    }
    let data = {}
    for (const key of keys) {
      data = {
        ...data,
        ...GistDatabase.deserialize(files[key].content, type)
      }
    }
    return data
  }

  public static async pack(
    path,
    value,
    { ttl, createdAt },
    type: CompressionType
  ) {
    const data = {
      value,
      ttl: {
        ttl,
        createdAt
      }
    }

    // eslint-disable-next-line no-undef
    const size = new Blob([JSON.stringify(GistDatabase.serialize(value, type))])
      .size

    if (
      size >
      GistDatabase.MAX_FILE_SIZE_BYTES * GistDatabase.MAX_FILES_PER_GIST
    ) {
      throw new Error(
        `attempting to write a value that is too large at ${path}`
      )
    }

    // cut an object in half, returning an array containing keys to the first half and the second half
    const bisect = (obj) => {
      const keys = Object.keys(obj)
      const half = Math.ceil(keys.length / 2)
      return [keys.slice(0, half), keys.slice(half)]
    }

    const keysToValues = (keys, obj) => {
      return keys.reduce((acc, key) => {
        acc[key] = obj[key]
        return acc
      }, {})
    }

    const toFiles = (
      obj,
      allResults = {}
    ): Record<
      string,
      {
        content: string
      }
    > => {
      let finished = false
      let index = 0
      let results = {}
      while (!finished) {
        const [firstHalf, secondHalf] = bisect(obj)

        const firstHalfSize = new Blob([
          this.serialize(keysToValues(firstHalf, obj), type)
        ]).size

        const secondHalfSize = new Blob([
          this.serialize(keysToValues(secondHalf, obj), type)
        ]).size

        if (
          GistDatabase.MAX_FILE_SIZE_BYTES >=
          firstHalfSize + secondHalfSize
        ) {
          results[GistDatabase.formatPath(path, index)] = {
            content: this.serialize(obj, type)
          }
          finished = true
        } else {
          if (firstHalfSize >= GistDatabase.MAX_FILE_SIZE_BYTES) {
            results = {
              ...allResults,
              ...toFiles(keysToValues(firstHalf, obj), allResults)
            }
          }
          if (secondHalfSize >= GistDatabase.MAX_FILE_SIZE_BYTES) {
            results = {
              ...allResults,
              ...toFiles(keysToValues(secondHalf, obj), allResults)
            }
          }
        }
        index++
      }
      return {
        ...allResults,
        ...results
      }
    }

    const files = toFiles(data)

    if (Object.keys(files).length > GistDatabase.MAX_FILES_PER_GIST) {
      throw new Error(
        `attempting to write a value that has too many files at ${path}`
      )
    }

    return files
  }

  public async set<T = any>(
    key: string | string[],
    args: {
      description?: string
      ttl?: number
      value?: T
    }
  ): Promise<Doc<T>> {
    const { description, ttl, value = {} } = args
    if (!isPlainObject(value)) {
      throw new Error('value must be a plain javascript object')
    }
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = GistDatabase.deserialize(
      root.files['database.json'].content,
      this.options.compression
    )

    const { id } = GistDatabase.get(database, path) || {}

    let gist: GistResponse

    if (id) {
      const files = await GistDatabase.pack(
        path,
        value,
        {
          ttl,
          createdAt: Date.now()
        },
        this.options.compression
      )

      gist = (await this.gistApi(`/gists/${id}`, 'PATCH', {
        description,
        files
      })) as GistResponse
    } else {
      const files = await GistDatabase.pack(
        path,
        value,
        {
          ttl,
          createdAt: Date.now()
        },
        this.options.compression
      )

      gist = (await this.gistApi('/gists', 'POST', {
        description,
        public: this.options.public,
        files
      })) as GistResponse
    }

    if (!id || ttl) {
      database[path.join('.')] = {
        id: gist.id,
        ttl: {
          ...GistDatabase.get(database, [path.join('.'), 'ttl']),
          ttl
        }
      }

      await this.gistApi(`/gists/${this.options.id}`, 'PATCH', {
        files: {
          'database.json': {
            content: GistDatabase.serialize(database, this.options.compression)
          }
        }
      })
    }

    return {
      value: value as T,
      gist,
      id: gist.id
    }
  }

  public async delete(key: string | string[]) {
    const path = Array.isArray(key) ? key : [key]
    const root = await this.getRoot()
    const database = GistDatabase.deserialize(
      root.files['database.json'].content,
      this.options.compression
    )
    const found: DocRef = GistDatabase.get(database, path)

    if (!found) {
      return undefined
    }

    await this.gistApi(`/gists/${found.id}`, 'DELETE')

    const newDatabase = GistDatabase.del(database, path)

    await this.gistApi(`/gists/${this.options.id}`, 'PATCH', {
      files: {
        'database.json': {
          content: GistDatabase.serialize(newDatabase, this.options.compression)
        }
      }
    })
  }

  public async deleteMany(keys: string[]) {
    return Promise.all(keys.map((key) => this.delete(key)))
  }

  public async destroy() {
    const root = await this.getRoot()
    const database = GistDatabase.deserialize(
      root.files['database.json'].content,
      this.options.compression
    )

    await Promise.allSettled(
      Object.keys(database).map(async (key) => {
        await this.gistApi(`/gists/${database[key].id}`, 'DELETE')
      })
    )

    await this.gistApi(`/gists/${this.options.id}`, 'DELETE')
  }

  public static get<T = any>(obj: T, path: string[]): T {
    const key = path.join('.')
    return obj[key]
  }

  public static set<T = any>(obj: T, path: string[], value: any): T {
    const key = path.join('.')
    return {
      ...obj,
      [key]: value
    }
  }

  public static del<T>(obj: T, path: string[]): T {
    const key = path.join('.')

    delete obj[key]

    return obj
  }

  public static ttlIsExpired(ttl: DocRef['ttl']) {
    return ttl.ttl && Date.now() - ttl.createdAt > ttl.ttl
  }

  public static formatPath(path: string[], index: number = 0) {
    return (Array.isArray(path) ? path.join('.') : path) + '_' + index + '.json'
  }

  public static serialize(value: any, type: CompressionType) {
    if (type === CompressionType.msgpack) {
      const serialized = pack(value)
      return JSON.stringify(serialized)
    } else if (type === CompressionType.pretty) {
      return JSON.stringify(value, null, 2)
    } else {
      return JSON.stringify(value)
    }
  }

  public static deserialize(value: any, type: CompressionType) {
    if (type === CompressionType.msgpack) {
      const buffer = Buffer.from(JSON.parse(value))
      return unpack(buffer)
    } else {
      return JSON.parse(value)
    }
  }
}
