import { getGistApi } from './gistApi'
import { GistDatabase } from './GistDatabase'

if (!process.env.GIST_TOKEN) {
  console.error('GIST_TOKEN is required')
  process.exit(1)
}

const gistApi = getGistApi({
  token: process.env.GIST_TOKEN
})

const main = async () => {
  console.log('Creating database...')

  const isPublic = process.argv[2] === 'public'

  const res = await GistDatabase.createDatabaseRoot({
    token: process.env.GIST_TOKEN,
    public: isPublic,
    description: process.argv[3]
  })

  console.log('Database created')

  console.log({
    id: res.id,
    url: res.url,
    public: isPublic,
    description: process.argv[3]
  })
}

main()