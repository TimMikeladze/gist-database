import { CompressionType, GistDatabase, GistResponse } from '../src'
import { pendingAlbums } from './data'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let index = 0

// for (const compressionType of Object.values(CompressionType)) {
for (const compressionType of [CompressionType.msgpack]) {
  it('GistDatabase - initialize with existing gist id', async () => {
    const db = new GistDatabase({
      token: process.env.GIST_TOKEN
    })

    await db.set('test', {
      value: {
        name: 'one'
      }
    })

    expect(db.getDatabaseId()).toBeDefined()

    const db2 = new GistDatabase({
      token: process.env.GIST_TOKEN,
      id: db.getDatabaseId()
    })

    await db2.set('test', {
      value: {
        name: 'two'
      }
    })
  })

  describe(`GistDatabase - compression: ${compressionType}`, () => {
    let db: GistDatabase
    beforeAll(async () => {
      db = new GistDatabase({
        token: process.env.GIST_TOKEN,
        compression: compressionType,
        encryptionKey:
          index % 2 === 0 ? process.env.GIST_ENCRYPTION_KEY : undefined
      })
    })
    afterAll(async () => {
      await db.destroy()
      index = index + 1
    })
    it('sets and gets', async () => {
      const res = await db.set('test_one', {
        value: {
          name: 'test_one'
        }
      })
      expect(res).toMatchObject({
        value: {
          name: 'test_one'
        },
        id: expect.any(String),
        gist: expect.any(Object)
      })
      expect(await db.get('test_one')).toMatchObject({
        value: {
          name: 'test_one'
        },
        id: expect.any(String),
        gist: expect.any(Object)
      })
    })
    it('gets all keys', async () => {
      await db.set('test_two', {
        value: {
          name: 'test_two'
        }
      })
      expect(await db.keys()).toEqual(['test_one', 'test_two'])
    })
    it('deletes', async () => {
      await db.set('test_two', {
        value: {
          name: 'test_two'
        }
      })
      expect(await db.get('test_two')).toMatchObject({
        value: {
          name: 'test_two'
        },
        id: expect.any(String),
        gist: expect.any(Object),
        rev: expect.any(String)
      })
      await db.delete('test_two')
      expect(await db.get('test_two')).toBeUndefined()
    })
    it('key with a ttl gets deleted', async () => {
      const res = await db.set('test_ttl', {
        value: {},
        ttl: 250
      })

      await sleep(500)

      expect(await db.get('test_ttl')).toBeUndefined()

      const found = (await db.gistApi(
        `/gists/${res.id}`,
        'GET'
      )) as GistResponse

      expect(found).toEqual({})
    })
    it('gets and deletes many', async () => {
      await db.set('test_many_one', {})
      await db.set('test_many_two', {})

      expect(await db.getMany(['test_many_one', 'test_many_two'])).toHaveLength(
        2
      )

      await db.deleteMany(['test_many_one', 'test_many_two'])

      expect(await db.getMany(['test_many_one', 'test_many_two'])).toEqual([
        undefined,
        undefined
      ])
    })

    it('sets and gets with revs', async () => {
      const initialRevision = GistDatabase.rev()

      const key = 'revs_tests'

      const res = await db.set(key, {
        value: {
          name: key
        },
        rev: initialRevision
      })

      expect(res).toMatchObject({
        value: {
          name: key
        },
        id: expect.any(String),
        gist: expect.any(Object),
        rev: initialRevision
      })

      const updated = await db.set(key, {
        value: {
          name: key
        }
      })

      await expect(
        db.set(key, {
          value: {
            name: key
          },
          rev: initialRevision
        })
      ).rejects.toThrowError()

      await db.set(key, {
        value: {
          name: key
        },
        rev: updated.rev
      })

      const found = await db.get(key)

      expect(found.rev).toBeDefined()
      expect(found.rev).not.toEqual(initialRevision)
      expect(found.rev).not.toEqual(updated.rev)

      await expect(
        db.get(key, {
          rev: initialRevision
        })
      ).rejects.toThrowError()
    })
  })
}

it('get and set and del static util functions', () => {
  const obj = {
    a: 1,
    b: {
      c: {}
    }
  }
  expect(GistDatabase.get(obj, ['a'])).toBe(1)
  expect(GistDatabase.get(obj, ['b', 'c'])).toBeUndefined()

  let res = GistDatabase.set(obj, ['a'], 2)
  expect(GistDatabase.get(res, ['a'])).toBe(2)
  res = GistDatabase.set(res, ['b', 'c'], { d: 3 })
  expect(GistDatabase.get(res, ['b', 'c'])).toEqual({ d: 3 })

  res = GistDatabase.del(res, ['b', 'c'])

  expect(GistDatabase.get(res, ['b', 'c'])).toBeUndefined()
  expect(GistDatabase.get(res, ['a'])).toBe(2)
})

describe('GistDatabase - works with nested keys', () => {
  let db: GistDatabase
  beforeAll(async () => {
    db = new GistDatabase({
      token: process.env.GIST_TOKEN,
      compression: CompressionType.pretty
    })
  })
  afterAll(async () => {
    await db.destroy()
  })
  it('writes and reads a nested key', async () => {
    await db.set(['parent'], {
      value: {
        name: 'parent'
      }
    })

    await db.set(['parent', 'child'], {
      value: {
        name: 'child'
      }
    })

    expect(await db.get(['parent'])).toMatchObject({
      value: {
        name: 'parent'
      }
    })

    expect(await db.get(['parent', 'child'])).toMatchObject({
      value: {
        name: 'child'
      }
    })
  })
})

describe('GistDatabase - validates key names', () => {
  let db: GistDatabase
  beforeAll(async () => {
    db = new GistDatabase({
      token: process.env.GIST_TOKEN,
      compression: CompressionType.pretty
    })
  })
  afterAll(async () => {
    await db.destroy()
  })
  it('checks key name', async () => {
    await db.set('test-test', {
      value: {
        name: 'test'
      }
    })

    await db.set('test_test', {
      value: {
        name: 'test'
      }
    })

    expect(await db.get('test-test')).toMatchObject({
      value: {
        name: 'test'
      }
    })

    expect(await db.get('test_test')).toMatchObject({
      value: {
        name: 'test'
      }
    })
  })
})

describe('GistDatabase - advanced scenario 1', () => {
  let db: GistDatabase
  beforeAll(async () => {
    db = new GistDatabase({
      token: process.env.GIST_TOKEN,
      compression: CompressionType.pretty
    })
  })
  afterAll(async () => {
    await db.destroy()
  })
  it('stores markdown files', async () => {
    const res = await db.set('test_markdown', {
      value: {
        name: 'test_markdown'
      },
      files: {
        'test.md': {
          content: '# Hello world'
        }
      }
    })

    expect(res).toMatchObject({
      files: {
        'test.md': {
          content: '# Hello world',
          url: expect.any(String)
        }
      }
    })

    const found = await db.get('test_markdown')

    expect(found).toMatchObject({
      files: {
        'test.md': {
          content: '# Hello world',
          url: expect.any(String)
        }
      }
    })

    await db.set('test_markdown', {
      value: {
        name: 'test_markdown'
      },
      files: {
        'test.md': {
          content: '# Hello world updated'
        },
        'test2.md': {
          content: '# Hello world 2'
        }
      }
    })

    const updated = await db.get('test_markdown')

    expect(updated).toMatchObject({
      value: {
        name: 'test_markdown'
      },
      files: {
        'test.md': {
          content: '# Hello world updated',
          url: expect.any(String)
        },
        'test2.md': {
          content: '# Hello world 2',
          url: expect.any(String)
        }
      }
    })

    const gist = await db.gistApi(
      `/gists/${updated.files['test.md'].id}`,
      'GET'
    )

    expect(gist).toMatchObject({
      files: {
        'test.md': {
          content: '# Hello world updated'
        }
      }
    })

    await db.delete('test_markdown')

    expect(
      await db.gistApi(`/gists/${updated.files['test.md'].id}`, 'GET')
    ).toEqual({})
  })
})

describe('GistDatabase - advanced scenario 2', () => {
  let db: GistDatabase
  beforeAll(async () => {
    db = new GistDatabase({
      token: process.env.GIST_TOKEN,
      compression: CompressionType.pretty
    })
  })
  afterAll(async () => {
    await db.destroy()
  })

  it('sets and gets value', async () => {
    await db.set('pendingAlbums', {
      value: pendingAlbums
    })

    let found = await db.get('pendingAlbums')

    expect(found).toMatchObject({
      value: pendingAlbums
    })

    expect(found.value.albums).toHaveLength(3)

    pendingAlbums.albums.pop()

    expect(found).not.toMatchObject({
      value: pendingAlbums
    })

    expect(found.value.albums).toHaveLength(3)

    expect(pendingAlbums.albums).toHaveLength(2)

    await db.set('pendingAlbums', {
      value: pendingAlbums
    })

    found = await db.get('pendingAlbums')

    expect(found.value.albums).toHaveLength(2)

    expect(found).toMatchObject({
      value: pendingAlbums
    })
  })
})
