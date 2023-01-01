# 🗄️ Gist Database

Turn [gist](https://gist.github.com/) into your personal key/value data-store.

- 🚀 [Example repo]() of a todo list build with Next.js.
- 🔗 [Demo app]() deployed with Vercel.

```console
npm install gist-database

yarn add gist-database

pnpm add gist-database
```

## 🚪 Introduction

Sometimes all a small project needs is the ability to persist some data. Imagine some simple data-model receives infrequent updates and could be represented as JSON object. It doesn't demand a full-blown database, but it would be nice to have a simple way to persist your data in a simple way.

This is where `gist-database` comes in handy, by leveraging the power of the [gist api](https://gist.github.com/) you can easily create a key/value data-store for your project.

This is a perfect solution for low write / high read scenarios when serving static site content with [Next.js](https://nextjs.org/) and using [Incremental Static Regeneration](https://nextjs.org/docs/basic-features/data-fetching/incremental-static-regeneration) to keep your cached content fresh.

> 👋 Hello there! Follow me [@linesofcodedev](https://twitter.com/linesofcodedev) or visit [linesofcode.dev](https://linesofcode.dev) for more cool projects like this one.

## 🏃 Getting started

In order to communicate with the Gist API you need to create a [personal access token](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) with the `gist` scope or use the [beta tokens](https://github.com/settings/tokens?type=beta) with the `gist read/write scope`.

Save this token somewhere safe, you will need it to authenticate with the Gist API.

Now let's create a new database. The empty database will be created as single gist containing a single file called `database.json` with an empty JSON object: `{}`.

This package comes with a cli command to help you get started.

In your terminal run the following command:

```console
GIST_TOKEN="xxxxx" npx gist-database

# or for a public gist
GIST_TOKEN="xxxxx" npx gist-database public

# or for a public gist with a description
GIST_TOKEN="xxxxx" npx gist-database public "My awesome database"
```

If successful, you should see output similar to:

```json
{
  "id": "xxxxxxxxxxxxxxxxxxx",
  "url": "https://api.github.com/gists/xxxxxxxxxxx"
}
```

This is the gist containing your main database file. Save the `id` somewhere safe. You will need it to initialize the database.

## 📖 API

```ts
import { GistDatabase } from 'gist-database'

const db = new GistDatabase({
  token: process.env.GIST_TOKEN,
  id: process.env.GIST_ID
})

const res = await db.set('key', {
  hello: 'world'
})

const found = await db.get('key')

/**
 {
  value : {
      hello: "world"
  },
  id: "xxxxxxxxxxxxxxxxxxx",
  url: "https://api.github.com/gists/xxxxxxxxxxx"
}
 **/

const updated = await db.set('key', {
  hello: 'world',
  foo: 'bar'
})

/**
 {
  value : {
      hello: "world"
      foo: "bar"
  },
  id: "xxxxxxxxxxxxxxxxxxx",
  url: "https://api.github.com/gists/xxxxxxxxxxx"
}
 **/

await db.has('key') // true

await db.delete('key') // void

await db.set(
  'key_with_ttl',
  {
    description: "I'll expire soon and be deleted upon retrieval"
  },
  1000
)

// Get or delete many keys at once. `undefined` will be returned for keys that don't exist.

await db.getMany(['key1', 'key2', 'key3'])

await db.deleteMany(['key1', 'key2', 'key3'])

// Remove all gist files and delete the database
await db.destroy()
```

## ⚠️ Limitations

1. This is **not** a replacement for a **production database!** Do not store data that you cannot afford to lose. If it's important, use the proper database solution for your problem.
1. This is not intended for **high write** scenarios. You will be rate limited by the GitHub API. This is package is intended for **low write**, **low concurrency** scenarios.
1. The maximum size of a provided object is approximately 0.99 mb. This is also the maximum size of the main database gist. In the future, this limit could be increased to 10mb with some additional packing logic. This brings me to the next point.
