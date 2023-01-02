# 🗄️ Gist Database

✨ Transform [gist](https://gist.github.com/) into your personal key/value data store.

```console
npm install gist-database

yarn add gist-database

pnpm add gist-database
```

## 🚪 Introduction

Sometimes all a project needs is the ability to read/write small amounts of JSON data and have it saved in some persistent storage. Imagine a simple data-model which receives infrequent updates and could be represented as JSON object. It doesn't demand a full-blown database, but it would be neat to have a way to interact with this data and have it persist across sessions.

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
GIST_TOKEN="xxxxxxxx" node node_modules/gist-database/dist/cli.modern.js

# or for a public gist
GIST_TOKEN="xxxxxxxx" node node_modules/gist-database/dist/cli.modern.js public

# or for a public gist with a description
GIST_TOKEN="xxxxxxxx" node node_modules/gist-database/dist/cli.modern.js public "My awesome database"
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

// Initialize the database

const db = new GistDatabase({
  token: process.env.GIST_TOKEN,
  id: process.env.GIST_ID
})

// Before we begin let's define an optional Tyescript interface to add some type-safety to the shape of our data. Tip: combine this with Zod for even more safety around your data and business logic.

interface ExampleData {
  hello: string
  foo?: string
}

const res = await db.set<ExampleData>('key', {
  value: {
    hello: 'world'
  }
})

const found = await db.get<ExampleData>('key')

/**
 {
  value : {
      hello: "world"
  },
  id: "xxxxxxxxxxxxxxxxxxx",
  url: "https://api.github.com/gists/xxxxxxxxxxx"
}
 **/

const updated = await db.set<ExampleData>('key', {
  value: {
    hello: 'world',
    foo: 'bar'
  }
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

await db.keys() // ['key']

await db.delete('key') // void

await db.set<ExampleData>('key_with_ttl', {
  ttl: 1000, // 1 second
  description: "I'll expire soon and be deleted upon retrieval"
})

// Get or delete many keys at once. `undefined` will be returned for keys that don't exist.
await db.getMany(['key1', 'key2', 'key3'])

await db.deleteMany(['key1', 'key2', 'key3'])

// Remove all gist files and delete the database
await db.destroy()
```

## 🏗️ How it works

The gist of it: each database is stored as multiple `.json` files with one or more of these files maintaining additional metadata about the database.

The main file is called `database.json` (this is the file corresponding to the id you provided during initialization). It serves multiple purposes, but is primarily used as a lookup table for gistIds with a specific key. It also contains additional metadata such as associating TTL values with keys. Take care when editing or removing this file as it is the source of truth for your database.

When a value is created or updated a new `.json` gist is created for the document. It contains the provided value plus additional metadata such as TTL. The id of this newly created gist is then added to the lookup table in `database.json`.

Each gist can contain up to 10 files, with each file having a maximum size of 1mb.

When data is written or read for a specific key, this library will chunk the data and pack it into multiple files within the gist to optimize storage.

## 🗜️ Compression

When initializing `GistDatabase` you can pass an optional parameter `compression` to control how data is serialized and deserialized. By default, the data is not compressed at all and is stored as plain JSON.

**Available compression options:**

- `none` - no compression
- `msgpck` - [msgpack](https://msgpack.org/) compression using [msgpackr](https://www.npmjs.com/package/msgpackr)
- `pretty` - Store data as well-formatted JSON, this is useful for debugging purposes or databases where the content needs to be easily human-readable.

## ⚠️ Limitations

1. This is **not** a replacement for a **production database!** Do not store data that you cannot afford to lose or that needs to remain consistent. If it's important, use the proper database solution for your problem.
1. This is not intended for **high write** scenarios. You will be rate limited by the GitHub API. This is package is intended for **low write**, **single session** scenarios.
1. The maximum size that a value can be is approximately 10mb. However, I suspect a request that large would simply be rejected by the API. It's not a scenario I'm building for as sophisticated storage is beyond the scope of this library. Once again this is not a real database, it should not be used for storing large documents.
