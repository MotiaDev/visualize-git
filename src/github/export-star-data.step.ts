import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'

const errorSchema = z.object({
  error: z.string(),
})

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'ExportStarData',
  description: 'Export star history data as CSV or JSON for download',
  flows: ['git-history'],
  method: 'GET',
  path: '/api/github/export-stars/:owner/:repo',
  queryParams: [
    { name: 'token', description: 'GitHub personal access token' },
    { name: 'format', description: 'Export format: csv or json (default: csv)' },
    { name: 'days', description: 'Days of history (default: 90)' },
  ],
  responseSchema: {
    200: z.any(), // Raw CSV or JSON
    403: errorSchema,
    500: errorSchema,
  },
  emits: [],
}

interface StargazerEdge {
  starredAt: string
}

interface GraphQLResponse {
  data?: {
    repository: {
      stargazerCount: number
      stargazers: {
        edges: StargazerEdge[]
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
      }
    }
  }
}

export const handler: Handlers['ExportStarData'] = async (req, { logger }) => {
  const { owner, repo } = req.pathParams
  const token = req.queryParams.token as string | undefined
  const format = (req.queryParams.format as string) || 'csv'
  const days = parseInt(req.queryParams.days as string) || 90

  logger.info('Exporting star data', { owner, repo, format, days })

  const githubToken = token || process.env.GITHUB_TOKEN

  if (!githubToken) {
    return {
      status: 403,
      body: { error: 'GitHub token required' },
    }
  }

  try {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const allStarDates: string[] = []
    let hasNextPage = true
    let cursor: string | null = null
    let totalStars = 0
    let requestCount = 0

    while (hasNextPage && requestCount < 15) {
      const query = `
        query($owner: String!, $repo: String!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            stargazerCount
            stargazers(first: 100, after: $cursor, orderBy: {field: STARRED_AT, direction: DESC}) {
              edges {
                starredAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `

      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `bearer ${githubToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { owner, repo, cursor },
        }),
      })

      if (!response.ok) break

      const result: GraphQLResponse = await response.json()
      if (!result.data?.repository) break

      totalStars = result.data.repository.stargazerCount
      const edges = result.data.repository.stargazers.edges

      let reachedStartDate = false
      for (const edge of edges) {
        const starDate = new Date(edge.starredAt)
        if (starDate < startDate) {
          reachedStartDate = true
          break
        }
        allStarDates.push(edge.starredAt.split('T')[0])
      }

      if (reachedStartDate) break

      hasNextPage = result.data.repository.stargazers.pageInfo.hasNextPage
      cursor = result.data.repository.stargazers.pageInfo.endCursor
      requestCount++
    }

    // Count daily stars
    const dailyCounts: Record<string, number> = {}
    for (const date of allStarDates) {
      dailyCounts[date] = (dailyCounts[date] || 0) + 1
    }

    // Build full date range
    const data: Array<{ date: string; daily: number; cumulative: number }> = []
    const current = new Date(startDate)
    let cumulative = totalStars - allStarDates.length

    while (current <= endDate) {
      const dateStr = current.toISOString().split('T')[0]
      const daily = dailyCounts[dateStr] || 0
      cumulative += daily

      data.push({
        date: dateStr,
        daily,
        cumulative: Math.min(cumulative, totalStars),
      })

      current.setDate(current.getDate() + 1)
    }

    // Ensure last entry has correct total
    if (data.length > 0) {
      data[data.length - 1].cumulative = totalStars
    }

    if (format === 'json') {
      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${owner}-${repo}-stars.json"`,
        },
        body: {
          repository: `${owner}/${repo}`,
          totalStars,
          exportedAt: new Date().toISOString(),
          days,
          data,
        },
      }
    }

    // CSV format
    const csvLines = ['date,daily_stars,cumulative_stars']
    for (const row of data) {
      csvLines.push(`${row.date},${row.daily},${row.cumulative}`)
    }
    const csv = csvLines.join('\n')

    return {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${owner}-${repo}-stars.csv"`,
      },
      body: csv,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Export failed', { error: message })

    return {
      status: 500,
      body: { error: message },
    }
  }
}

