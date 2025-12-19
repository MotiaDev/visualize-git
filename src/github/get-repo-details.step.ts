import { ApiRouteConfig, Handlers } from 'motia'

export const config: ApiRouteConfig = {
  name: 'Get Repository Details',
  type: 'api',
  method: 'GET',
  path: '/api/github/repo/:owner/:repo',
  queryParams: [
    { name: 'token', description: 'GitHub personal access token for higher rate limits' },
  ],
  emits: [],
  flows: ['github'],
}

export const handler: Handlers['GetRepositoryDetails'] = async (req, ctx) => {
  const { owner, repo } = req.pathParams as Record<string, string>
  const { token } = req.queryParams as Record<string, string>
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'GitGalaxy-App',
  }
  
  // Use provided token or environment variable
  const githubToken = token || process.env.GITHUB_TOKEN
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      ctx.logger.error('GitHub API error', { owner, repo, status: response.status })
      
      return {
        status: response.status,
        body: {
          error: error.message || 'Failed to fetch repository',
        }
      }
    }

    const data = await response.json()
    ctx.logger.info('Fetched repo details', { owner, repo, stars: data.stargazers_count })

    return {
      status: 200,
      body: {
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        defaultBranch: data.default_branch,
        url: data.html_url,
        owner: {
          login: data.owner.login,
          avatar: data.owner.avatar_url,
        },
      }
    }
  } catch (error) {
    ctx.logger.error('Exception fetching repo', { error: error instanceof Error ? error.message : 'Unknown error' })
    
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Failed to fetch repository details',
      }
    }
  }
}
