#!/usr/bin/env node

import { GistDatabase } from './GistDatabase'
import { program } from 'commander'

interface CommanderOptions {
  create: boolean
  description: string
  destroy: string
  public: boolean
  token: string
}

const main = async () => {
  program
    .name('gist-database')
    .description('Transform gist into a key/value datastore.')
    .option('-c --create', 'Create a new gist database.')
    .option('-p --public', 'Make the gist public.', false)
    .option('-de --description <description>', 'Description of the gist.', '')
    .option(
      '-des --destroy <destroy>',
      'Destroy a gist database. Provide the gist id of the database.'
    )
    .requiredOption(
      '-t --token <token>',
      'Gist token. Required for all operations.'
    )
  try {
    program.parse(process.argv)

    const options: CommanderOptions = program.opts()

    if (options.create) {
      console.log('Creating database...')
      const res = await GistDatabase.createDatabaseRoot({
        token: options.token,
        public: options.public,
        description: options.description
      })
      console.log('Database created!')
      console.log({
        id: res.id,
        rawUrl: res.url,
        url: `https://gist.github.com/${res.id}`,
        public: options.public,
        description: options.description
      })
    } else if (options.destroy) {
      console.log('Destroying database...')
      const db = new GistDatabase({
        token: options.token,
        id: options.destroy
      })
      await db.destroy()
      console.log('Database destroyed!')
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }

  process.exit()
}

main()
