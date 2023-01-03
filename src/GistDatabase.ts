import isPlainObject from 'is-plain-obj'
import { getGistApi } from './gistApi'
import { Blob } from 'buffer'
import { pack, unpack } from 'msgpackr'
import Cryptr from 'cryptr'
import { nanoid } from 'nanoid'

export enum CompressionType {
  // eslint-disable-next-line no-unused-vars
  msgpack = 'msgpack',
  // eslint-disable-next-line no-unused-vars
  none = 'none',
  // eslint-disable-next-line no-unused-vars
  pretty = 'pretty'
}

export interface GistDatabaseOptions {
  compression?: CompressionType
  description?: string
  encryptionKey?: string
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

export interface ExtraFile {
  content?: string
  gist?: GistResponse
  id: string
  url: string
}

export type ExtraFiles = Record<string, ExtraFile>

export type Doc<T = any> = {
  extraFile: ExtraFile
  files: ExtraFiles
  gist: {
    [key: string]: any
    id: string
  }
  id: string
  rev: string
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
  private readonly cryptr: Cryptr
  public static ROOT_GIST_NAME = 'database.json'

  constructor(options: GistDatabaseOptions) {
    this.options = {
      ...defaultOptions,
      ...options
    }
    this.gistApi = getGistApi({
      token: this.options.token
    })
    this.cryptr = this.options.encryptionKey
      ? new Cryptr(this.options.encryptionKey)
      : undefined
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

    const cryptr = options.encryptionKey
      ? new Cryptr(options.encryptionKey)
      : undefined

    return gistApi('/gists', 'POST', {
      description: options.description,
      public: options.public,
      files: {
        [GistDatabase.ROOT_GIST_NAME]: {
          content: GistDatabase.serialize({}, options.compression, cryptr)
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
      root.files[GistDatabase.ROOT_GIST_NAME].content,
      this.options.compression,
      this.cryptr
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

  public async get<T = any>(
    key: string | string[],
    {
      rev
    }: {
      rev?: string
    } = {}
  ): Promise<Doc<T>> {
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = GistDatabase.deserialize(
      root.files[GistDatabase.ROOT_GIST_NAME].content,
      this.options.compression,
      this.cryptr
    )

    const foundDocRef: DocRef = GistDatabase.get(database, path)

    if (!foundDocRef) {
      return undefined
    }

    if (foundDocRef.ttl.ttl && GistDatabase.ttlIsExpired(foundDocRef.ttl)) {
      await this.deleteExtraFilesForGist({
        id: foundDocRef.id
      })
      await this.gistApi(`/gists/${foundDocRef.id}`, 'DELETE')
      return undefined
    }

    const gist = (await this.gistApi(
      `/gists/${foundDocRef.id}`,
      'GET'
    )) as GistResponse

    if (!gist) {
      return undefined
    }

    if (!gist?.files || !Object.keys(gist.files).length) {
      return undefined
    }

    const doc = GistDatabase.unpack(
      gist.files,
      this.options.compression,
      this.cryptr
    ) as DocRef & Doc<T>

    const files: ExtraFiles = {}

    if (doc.extraFile) {
      const gist = (await this.gistApi(
        `/gists/${doc.extraFile.id}`,
        'GET'
      )) as GistResponse

      if (gist && gist.files && Object.keys(gist.files).length) {
        Object.keys(gist.files).forEach((key) => {
          files[key] = {
            content: gist.files[key].content,
            id: doc.extraFile.id,
            url: doc.extraFile.url
          }
        })
      }
    }

    doc.files = files

    const ttl = doc.ttl

    if (ttl.ttl && GistDatabase.ttlIsExpired(ttl)) {
      await this.deleteExtraFilesForGist({
        doc
      })
      await this.gistApi(`/gists/${foundDocRef.id}`, 'DELETE')
      return undefined
    }

    if (rev && doc.rev !== rev) {
      throw new Error(GistDatabase.formatRevisionError(doc.rev, rev))
    }

    return {
      gist,
      id: foundDocRef.id,
      value: doc.value,
      rev: doc.rev,
      files: doc.files,
      extraFile: doc.extraFile
    }
  }

  public getMany(keys: string[]): Promise<Doc[]> {
    return Promise.all(keys.map((key) => this.get(key)))
  }

  public async has(key: string | string[]): Promise<boolean> {
    return (await this.get(key)) !== undefined
  }

  public static unpack(
    files: GistResponse['files'],
    type: CompressionType,
    cryptr: Cryptr
  ) {
    const keys = Object.keys(files)
    if (!keys.length) {
      return undefined
    }

    // filter all keys which match the pattern "_${index}.json"
    const jsonKeys = keys.filter((key) => key.match(/_\d+\.json$/))

    let data = {}
    for (const key of jsonKeys) {
      data = {
        ...data,
        ...GistDatabase.deserialize(files[key].content, type, cryptr)
      }
    }

    return data
  }

  public static async pack(
    path,
    value,
    {
      ttl,
      createdAt,
      rev,
      extraFile = null
    }: {
      createdAt?: number
      extraFile?: ExtraFile
      rev?: string
      ttl?: number
    },
    type: CompressionType,
    cryptr: Cryptr
  ) {
    const data = {
      value,
      ttl: {
        ttl,
        createdAt
      },
      rev,
      extraFile
    }

    // eslint-disable-next-line no-undef
    const size = new Blob([
      JSON.stringify(GistDatabase.serialize(value, type, cryptr))
    ]).size

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
          this.serialize(keysToValues(firstHalf, obj), type, cryptr)
        ]).size

        const secondHalfSize = new Blob([
          this.serialize(keysToValues(secondHalf, obj), type, cryptr)
        ]).size

        if (
          GistDatabase.MAX_FILE_SIZE_BYTES >=
          firstHalfSize + secondHalfSize
        ) {
          results[GistDatabase.formatPath(path, index)] = {
            content: this.serialize(obj, type, cryptr)
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
      files?: Record<
        string,
        {
          content: string
        }
      >
      rev?: string
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
      root.files[GistDatabase.ROOT_GIST_NAME].content,
      this.options.compression,
      this.cryptr
    )

    const { id } = GistDatabase.get(database, path) || {}

    let gist: GistResponse

    let created = false

    const newRev = nanoid()

    let doc: Doc<T>

    const extraFiles: ExtraFiles = {}
    let extraFile: ExtraFile

    // Update existing gist
    if (id) {
      if (args.rev) {
        doc = await this.get(key)
        if (doc && doc.rev !== args.rev) {
          throw new Error(GistDatabase.formatRevisionError(doc.rev, args.rev))
        }
      }

      if (args.files && Object.keys(args.files).length) {
        if (!doc) {
          doc = await this.get(key)
        }
        const gist = (await this.gistApi(
          `/gists/${doc.extraFile.id}`,
          'PATCH',
          {
            files: args.files
          }
        )) as GistResponse

        extraFile = {
          id: gist.id,
          url: gist.url
        }

        Object.keys(args.files).forEach((key) => {
          extraFiles[key] = {
            id: gist.id,
            url: gist.url,
            gist,
            content: gist.files[key].content
          }
        })
      }

      const files = await GistDatabase.pack(
        path,
        value,
        {
          ttl,
          createdAt: Date.now(),
          rev: newRev,
          extraFile
        },
        this.options.compression,
        this.cryptr
      )

      gist = (await this.gistApi(`/gists/${id}`, 'PATCH', {
        description,
        files
      })) as GistResponse
    } else {
      // Create new gist

      if (args.files && Object.keys(args.files).length) {
        const gist = (await this.gistApi('/gists', 'POST', {
          public: this.options.public,
          files: args.files
        })) as GistResponse

        extraFile = {
          id: gist.id,
          url: gist.url
        }

        Object.keys(args.files).forEach((key) => {
          extraFiles[key] = {
            id: gist.id,
            url: gist.url,
            gist,
            content: gist.files[key].content
          }
        })
      }

      const files = await GistDatabase.pack(
        path,
        value,
        {
          ttl,
          createdAt: Date.now(),
          rev: args.rev || GistDatabase.rev(),
          extraFile
        },
        this.options.compression,
        this.cryptr
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
          [GistDatabase.ROOT_GIST_NAME]: {
            content: GistDatabase.serialize(
              database,
              this.options.compression,
              this.cryptr
            )
          }
        }
      })

      created = true
    }

    return {
      value: value as T,
      gist,
      id: gist.id,
      rev: created && args.rev ? args.rev : newRev,
      files: extraFiles,
      extraFile
    }
  }

  public async delete(key: string | string[]) {
    const path = Array.isArray(key) ? key : [key]
    const root = await this.getRoot()
    const database = GistDatabase.deserialize(
      root.files[GistDatabase.ROOT_GIST_NAME].content,
      this.options.compression,
      this.cryptr
    )
    const found: DocRef = GistDatabase.get(database, path)

    if (!found) {
      return undefined
    }

    const doc = await this.get(key)

    await this.deleteExtraFilesForGist({
      doc
    })

    await this.gistApi(`/gists/${found.id}`, 'DELETE')

    const newDatabase = GistDatabase.del(database, path)

    await this.gistApi(`/gists/${this.options.id}`, 'PATCH', {
      files: {
        [GistDatabase.ROOT_GIST_NAME]: {
          content: GistDatabase.serialize(
            newDatabase,
            this.options.compression,
            this.cryptr
          )
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
      root.files[GistDatabase.ROOT_GIST_NAME].content,
      this.options.compression,
      this.cryptr
    )

    await Promise.allSettled(
      Object.keys(database).map(async (key) => {
        await this.deleteExtraFilesForGist(database[key].id)
        await this.gistApi(`/gists/${database[key].id}`, 'DELETE')
      })
    )

    await this.gistApi(`/gists/${this.options.id}`, 'DELETE')
  }

  private async deleteExtraFilesForGist({
    id,
    doc
  }: {
    doc?: Doc<any>
    id?: string
  }) {
    let foundDoc: Doc<any>
    if (id) {
      foundDoc = await this.get(id)
    } else {
      foundDoc = doc
    }
    if (Object.keys(foundDoc.files).length) {
      await Promise.all(
        Object.keys(foundDoc.files).map((key) => {
          const file = foundDoc.files[key]
          return this.gistApi(`/gists/${file.id}`, 'DELETE')
        })
      )
    }
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

  public static serialize(value: any, type: CompressionType, cryptr: Cryptr) {
    const getData = () => {
      if (type === CompressionType.msgpack) {
        const serialized = pack(value)
        return JSON.stringify(serialized)
      } else if (type === CompressionType.pretty) {
        return JSON.stringify(value, null, 2)
      } else {
        return JSON.stringify(value)
      }
    }
    if (cryptr) {
      return cryptr.encrypt(getData())
    }
    return getData()
  }

  public static deserialize(value: any, type: CompressionType, cryptr: Cryptr) {
    if (type === CompressionType.msgpack) {
      const buffer = Buffer.from(
        JSON.parse(cryptr ? cryptr.decrypt(value) : value)
      )
      return unpack(buffer)
    } else {
      return JSON.parse(cryptr ? cryptr.decrypt(value) : value)
    }
  }

  public static rev() {
    return nanoid()
  }

  public static formatRevisionError(expected: string, received: string) {
    return `rev mismatch, expected ${expected} but was received ${received}`
  }
}
