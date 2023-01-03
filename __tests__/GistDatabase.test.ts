import { CompressionType, GistDatabase, GistResponse } from '../src'
import { pendingAlbums } from './data'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let index = 0

for (const compressionType of Object.values(CompressionType)) {
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
      expect(await db.get('test_one')).toEqual({
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
      expect(await db.get('test_two')).toEqual({
        value: {
          name: 'test_two'
        },
        id: expect.any(String),
        gist: expect.any(Object)
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
  })
}

it('get and set and del', () => {
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

describe('GistDatabase - advanced scenario', () => {
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
