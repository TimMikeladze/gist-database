import { CompressionType, GistDatabase, GistResponse } from '../src'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

for (const compressionType of Object.values(CompressionType)) {
  describe(`GistDatabase - compression: ${compressionType}`, () => {
    let db: GistDatabase
    beforeAll(async () => {
      db = new GistDatabase({
        token: process.env.GIST_TOKEN,
        compression: compressionType
      })
      await db.init()
    })
    afterAll(async () => {
      await db.destroy()
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
    }, 30000)
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
    }, 30000)
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
  expect(GistDatabase.get(obj, ['b', 'c'])).toEqual({})

  let res = GistDatabase.set(obj, ['a'], 2)
  expect(GistDatabase.get(res, ['a'])).toBe(2)
  res = GistDatabase.set(res, ['b', 'c'], { d: 3 })
  expect(GistDatabase.get(res, ['b', 'c'])).toEqual({ d: 3 })

  res = GistDatabase.del(res, ['b', 'c'])

  expect(GistDatabase.get(res, ['b', 'c'])).toBeUndefined()
  expect(GistDatabase.get(res, ['a'])).toBe(2)
})
