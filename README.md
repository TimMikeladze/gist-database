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

## ⚖️‍ Acceptable use policy

When using this library you **must comply** with Github's [acceptable use policy](https://docs.github.com/en/github/site-policy/github-acceptable-use-policies). Do not use this library to store data that violates Github's guidelines, violates laws, is malicious, unethical, or harmful to others.

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

const original = await db.set<ExampleData>('key', {
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
  url: "https://api.github.com/gists/xxxxxxxxxxx",
  rev: "xxxxx"
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
  rev: "yyyyy",
}
 **/

// A rev can be used to ensure that the data is not overwritten by another process. If the rev does not match the current rev, the update will fail.
try {
  await updated.set<ExampleData>('key', {
    value: {
      hello: 'world',
      foo: 'bar'
    },
    rev: original.rev // this will throw an error
    // rev: Database.rev() // leave field blank or manually generate a new rev
  })
} catch (err) {
  // An error will be thrown due to the rev mismatch
  console.log(err)
}

// Trying to fetch an outdated rev will also throw an error
try {
  await updated.get<ExampleData>('key', {
    rev: original.rev // this will throw an error
    // rev: updated.rev // this will succeed
  })
} catch (err) {
  // An error will be thrown due to the rev mismatch
  console.log(err)
}

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

## 📄 Storing markdown files

Gists lend themselves perfectly to storing markdown files which you can then revise over time. This is a great way to keep track of your notes, ideas, or even use Gist as a headless CMS to manage your blog posts.

> **❗Important note:** These files will be stored as is without any **compression** or **encryption** and there is no additional guarding around inconsistent writes using revision ids when writing to the gist containing these files.

Out of the box this library supports storing additional files beyond the `value` argument passed to `set`. They will be stored as a separate gist file and be part of the response when calling `get` or `set`.

This is useful for storing `.md` files or other assets like `.yml` files alongside some data while circumventing the packing, compression and encryption that is typically applied to the `value` argument.

```ts
const blogId = 'xxxxxx'

await db.set(`blog_${blogId}`, {
  value: {
    tags: ['javascript', 'typescript', 'gist-database'],
    title: 'My blog post'
  },
  files: [
    {
      name: `blog_${id}.md`,
      content: `# My blog post
Gist Database is pretty cool.`
    }
  ]
})

await db.get(`blog_${blogId}`)

/**
 {
  value : {
    tags: ['javascript', 'typescript', 'gist-database'],
    title: 'My blog post',
  },
  id: "xxxxxxxxxxxxxxxxxxx",
  url: "https://api.github.com/gists/xxxxxxxxxxx"
  rev: "xxxxx",
  files: [
    {
      name: 'blog_${id}.md',
      content: `# My blog post
Gist Database is pretty cool.`
    }
  ]
}
 **/
```

## 🗜️ Compression

When initializing `GistDatabase` you can pass an optional parameter `compression` to control how data is serialized and deserialized. By default, the data is not compressed at all and is stored as plain JSON.

**Available compression options:**

- `none` - no compression
- `msgpck` - [msgpack](https://msgpack.org/) compression using [msgpackr](https://www.npmjs.com/package/msgpackr)
- `pretty` - Store data as well-formatted JSON, this is useful for debugging purposes or databases where the content needs to be easily human-readable.

## 🔐 Encryption

When initializing `GistDatabase` you can pass an optional parameter called `encryptionKey` to enable `aes-256-gcm` encryption and decryption using the [cryptr](https://github.com/MauriceButler/cryptr) package.

```ts
const db = new GistDatabase({
  token: process.env.GIST_TOKEN,
  id: process.env.GIST_ID,
  encryptionKey: process.env.GIST_ENCRYPTION_KEY
})
```

## 🧮 Revisions

Each time a value is set, a new `rev` id is generated using the [nanoid](https://github.com/ai/nanoid) package. This revision is used to ensure that the data is not overwritten by another process. Before data is written the document for the corresponding key will be fetched its revision id checked with one provided. If they do not match the update will fail and an error will be thrown.

By default, revisions are not checked when getting or setting data. To enable revision checking, pass the `rev` parameter to `get` or `set`. Typically, this would be the `rev` value returned from the previous `get` or `set` call for the same key.

This is a dirty implementation of optimistic locking. It is not a perfect solution, but it is a simple way of **trying** to keep data consistent during concurrent writes. If you're looking for consistency guarantees then you should use a proper database solution, not this library.

## ⚠️ Limitations

1. This is **not** a replacement for a **production database!** Do not store data that you cannot afford to lose or that needs to remain consistent. If it's important, use the proper database solution for your problem.
1. This is not intended for **high write** scenarios. You will be rate limited by the GitHub API. This is package is intended for **low write**, **single session** scenarios.
1. The maximum size that a value can be is approximately 10mb. However, I suspect a request that large would simply be rejected by the API. It's not a scenario I'm building for as sophisticated storage is beyond the scope of this library. Once again this is not a real database, it should not be used for storing large documents.
