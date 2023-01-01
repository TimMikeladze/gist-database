import fetch from 'node-fetch'

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
      body: method === 'GET' ? undefined : JSON.stringify(body)
    })

    if (res.ok) {
      try {
        const json = (await res.json()) as {
          files: Record<string, any>
        }
        return json
      } catch (err) {
        return {}
      }
    } else {
      return {}
    }
  }
