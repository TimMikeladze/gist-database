import crypto from 'crypto'
import isPlainObject from 'is-plain-obj'
import fetch from 'node-fetch'

export interface GistDatabaseOptions {
  description?: string
  gistId?: string
  public?: boolean
  token: string
}

export type MinimalGist = {
  files: Record<
    string,
    {
      content: string
    }
  >
  id: string
}

export const getGistApi =
  (options: { encryptionKey?: string; token: string }) =>
  async (
    path: string,
    method: 'POST' | 'GET' | 'PATCH' | 'DELETE',
    body: Record<string, any> = {}
  ) => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body:
        method === 'GET'
          ? undefined
          : options.encryptionKey
          ? encrypt(JSON.stringify(body), options.encryptionKey)
          : JSON.stringify(body)
    })

    if (res.ok) {
      try {
        const json = (await res.json()) as {
          files: Record<string, any>
        }
        const fileKeys = Object.keys(json.files)
        fileKeys.forEach((key) => {
          const file = options.encryptionKey
            ? decrypt(fileKeys[key], options.encryptionKey)
            : json.files[key]
          json.files[key] = file
        })
        return json
      } catch (err) {
        return {}
      }
    } else {
      return {}
    }
  }

export const defaultOptions: Partial<GistDatabaseOptions> = {
  public: false
}

export class GistDatabase {
  private options: GistDatabaseOptions
  private readonly gistApi: ReturnType<typeof getGistApi>
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

  public async init() {
    let gist
    if (!this.options.gistId) {
      gist = await this.gistApi('/gists', 'POST', {
        description: this.options.description,
        public: this.options.public,
        files: {
          'database.json': {
            content: JSON.stringify({})
          }
        }
      })
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

  public async getRoot(): Promise<MinimalGist> {
    return (await this.gistApi(
      `/gists/${this.options.gistId}`,
      'GET'
    )) as MinimalGist
  }

  public async get(
    key: string | string[],
    direct: boolean = false
  ): Promise<{
    gist: any
    id: string
    value: Record<string, any>
  }> {
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = JSON.parse(root.files['database.json'].content)

    const id = get(database, path)

    if (!id) {
      return undefined
    }

    const gist = (await this.gistApi(`/gists/${id}`, 'GET')) as MinimalGist

    if (!gist) {
      return undefined
    }

    return {
      gist,
      id,
      value: JSON.parse(gist.files['value.json'].content)
    }
  }

  public async has(key: string | string[]) {
    return (await this.get(key)) !== undefined
  }

  public async set(
    key: string | string[],
    value: any,
    ttl?: number,
    description?: string
  ): Promise<{
    gist: any
    id: string
    value: Record<string, any>
  }> {
    if (!isPlainObject(value)) {
      throw new Error('value must be a plain javascript object')
    }
    const path = Array.isArray(key) ? key : [key]

    const root = await this.getRoot()

    const database = JSON.parse(root.files['database.json'].content)

    const id = get(database, path)

    let gist: MinimalGist

    if (id) {
      gist = (await this.gistApi(`/gists/${id}`, 'PATCH', {
        files: {
          'value.json': {
            content: JSON.stringify(value)
          }
        }
      })) as MinimalGist
    } else {
      gist = (await this.gistApi('/gists', 'POST', {
        description,
        public: this.options.public,
        files: {
          'value.json': {
            content: JSON.stringify(value)
          }
        }
      })) as MinimalGist
    }

    if (!id) {
      const newDatabase = set(database, path, gist.id)
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
    const id = get(database, path)
    if (!id) {
      return undefined
    }
    await this.gistApi(`/gists/${id}`, 'DELETE')

    const newDatabase = del(database, path)

    await this.gistApi(`/gists/${this.options.gistId}`, 'PATCH', {
      files: {
        'database.json': {
          content: JSON.stringify(newDatabase)
        }
      }
    })
  }

  public async destroy() {
    await this.gistApi(`/gists/${this.options.gistId}`, 'DELETE')
  }
}

export const get = (obj: any, path: string[]) => {
  if (path.length === 0) {
    return obj
  }
  const [key, ...rest] = path
  if (obj[key] === undefined) {
    return undefined
  }
  return get(obj[key], rest)
}

export const set = (obj: any, path: string[], value: any) => {
  if (path.length === 0) {
    return value
  }
  const [key, ...rest] = path
  return {
    ...obj,
    [key]: set(obj[key], rest, value)
  }
}

export const del = (obj: any, path: string[]) => {
  if (path.length === 0) {
    return undefined
  }
  const [key, ...rest] = path
  if (obj[key] === undefined) {
    return obj
  }
  return {
    ...obj,
    [key]: del(obj[key], rest)
  }
}

// https://gist.github.com/vlucas/2bd40f62d20c1d49237a109d491974eb

const IV_LENGTH = 16 // For AES, this is always 16

function encrypt(text, encryptionKey) {
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

function decrypt(text, encryptionKey) {
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
