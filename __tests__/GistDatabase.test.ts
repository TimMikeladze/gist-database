import { get, set, GistDatabase, del } from '../src'

describe('GistDatabase', () => {
  let db: GistDatabase
  beforeAll(() => {
    db = new GistDatabase({
      token: process.env.GITHUB_TOKEN
    })
  })
  afterAll(async () => {
    await db.destroy()
  })
  it('initializes', async () => {
    expect(await db.init()).toMatchObject({
      id: expect.any(String)
    })
    expect(db).toBeDefined()
  })
  it('sets and gets', async () => {
    const res = await db.set('test_one', {
      name: 'test_one'
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
      name: 'test_two'
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
})

it('get and set and del', () => {
  const obj = {
    a: 1,
    b: {
      c: {}
    }
  }
  expect(get(obj, ['a'])).toBe(1)
  expect(get(obj, ['b', 'c'])).toEqual({})

  let res = set(obj, ['a'], 2)
  expect(get(res, ['a'])).toBe(2)
  res = set(res, ['b', 'c'], { d: 3 })
  expect(get(res, ['b', 'c'])).toEqual({ d: 3 })

  res = del(res, ['b', 'c'])

  expect(get(res, ['b', 'c'])).toBeUndefined()
  expect(get(res, ['a'])).toBe(2)
})
