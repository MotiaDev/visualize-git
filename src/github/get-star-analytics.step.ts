import { ApiRouteConfig, Handlers } from 'motia'
import { z } from 'zod'

const dailyStarSchema = z.object({
  date: z.string(),
  daily: z.number(), // Stars gained that day
  cumulative: z.number(), // Total stars up to that day
})

const hourlyStarSchema = z.object({
  hour: z.string(), // ISO timestamp for the hour
  stars: z.number(),
})

const trendsSchema = z.object({
  avg7d: z.number(), // 7-day average daily stars
  avg30d: z.number(), // 30-day average daily stars
  peakDay: z.object({
    date: z.string(),
    stars: z.number(),
  }),
  velocity: z.number(), // Current growth rate (stars/day)
  trend: z.enum(['up', 'down', 'stable']),
  growthRate: z.number(), // Percentage growth last 30d
})

const responseSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  totalStars: z.number(),
  createdAt: z.string(),
  ageInDays: z.number(),
  avgStarsPerDay: z.number(),
  dailyHistory: z.array(dailyStarSchema), // Complete history from repo creation
  hourlyActivity: z.array(hourlyStarSchema), // Last 7 days hourly
  trends: trendsSchema,
  recentActivity: z.array(dailyStarSchema), // Last 30 days
  dataCompleteness: z.number(), // Percentage of stars we have dates for
})

const errorSchema = z.object({
  error: z.string(),
})

export const config: ApiRouteConfig = {
  type: 'api',
  name: 'GetStarAnalytics',
  description: 'Complete star analytics with full daily history from repo creation, hourly breakdown, and trends',
  flows: ['git-history'],
  method: 'GET',
  path: '/api/github/star-analytics/:owner/:repo',
  queryParams: [
    { name: 'token', description: 'GitHub personal access token' },
    { name: 'full', description: 'Fetch complete history (slower but comprehensive)' },
  ],
  responseSchema: {
    200: responseSchema,
    403: errorSchema,
    500: errorSchema,
  },
  emits: [],
}

interface StargazerWithDate {
  starred_at: string
  user: { login: string }
}

// Simple in-memory cache to avoid re-fetching
const starCache = new Map<string, { timestamp: number; data: StargazerWithDate[] }>()
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

export const handler: Handlers['GetStarAnalytics'] = async (req, { logger }) => {
  const { owner, repo } = req.pathParams
  const token = req.queryParams.token as string | undefined
  const fetchFull = req.queryParams.full === 'true'

  const cacheKey = `${owner}/${repo}`
  logger.info('Fetching star analytics', { owner, repo, fetchFull })

  const headers: HeadersInit = {
    Accept: 'application/vnd.github.star+json', // Required for starred_at timestamps
  }

  const githubToken = token || process.env.GITHUB_TOKEN
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`
  }

  try {
    // Get repo info first
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json', Authorization: headers['Authorization'] || '' },
    })

    if (!repoResponse.ok) {
      throw new Error(`Failed to fetch repo: ${repoResponse.statusText}`)
    }

    const repoData = await repoResponse.json()
    const totalStars = repoData.stargazers_count
    const createdAt = repoData.created_at.split('T')[0]
    
    // Calculate age
    const createdDate = new Date(createdAt)
    const today = new Date()
    const ageInDays = Math.floor((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24))
    const avgStarsPerDay = ageInDays > 0 ? totalStars / ageInDays : totalStars

    // Check cache
    const cached = starCache.get(cacheKey)
    let allStargazers: StargazerWithDate[] = []
    
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      logger.info('Using cached stargazers', { count: cached.data.length })
      allStargazers = cached.data
    } else {
      // Fetch stargazers with pagination
      // Strategy: Fetch from both ends concurrently for faster retrieval
      const starsPerPage = 100
      const totalPages = Math.ceil(totalStars / starsPerPage)
      
      // Limit pages to fetch based on mode
      // Full mode: fetch all (can be slow for large repos)
      // Quick mode: fetch first 50 + last 50 pages (covers history + recent)
      const maxPages = fetchFull ? totalPages : Math.min(100, totalPages)
      
      logger.info('Fetching stargazers', { totalStars, totalPages, maxPages })
      
      // Fetch pages concurrently in batches to respect rate limits
      const BATCH_SIZE = 10
      const pagesToFetch: number[] = []
      
      if (fetchFull || totalPages <= 100) {
        // Fetch all pages
        for (let i = 1; i <= Math.min(totalPages, maxPages); i++) {
          pagesToFetch.push(i)
        }
      } else {
        // Smart sampling: first 30 pages + last 70 pages (to get complete history shape)
        for (let i = 1; i <= 30; i++) pagesToFetch.push(i)
        for (let i = totalPages - 69; i <= totalPages; i++) {
          if (i > 30) pagesToFetch.push(i)
        }
      }

      for (let i = 0; i < pagesToFetch.length; i += BATCH_SIZE) {
        const batch = pagesToFetch.slice(i, i + BATCH_SIZE)
        
        const results = await Promise.all(
          batch.map(async (page) => {
            const url = `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${starsPerPage}&page=${page}`
            const response = await fetch(url, { headers })
            
            if (response.status === 403) {
              logger.warn('Rate limit hit', { page })
              return []
            }
            
            if (!response.ok) return []
            
            return response.json() as Promise<StargazerWithDate[]>
          })
        )
        
        results.forEach(stars => allStargazers.push(...stars))
        
        // Check if we hit rate limit
        if (results.some(r => Array.isArray(r) && r.length === 0)) {
          // Check rate limit
          const rateCheck = await fetch('https://api.github.com/rate_limit', {
            headers: { Authorization: headers['Authorization'] || '' },
          })
          const rateData = await rateCheck.json()
          if (rateData.resources?.core?.remaining < 10) {
            logger.warn('Rate limit nearly exhausted, stopping', { remaining: rateData.resources?.core?.remaining })
            break
          }
        }
      }
      
      // Cache the results
      if (allStargazers.length > 0) {
        starCache.set(cacheKey, { timestamp: Date.now(), data: allStargazers })
      }
    }

    logger.info('Processing stargazers', { fetched: allStargazers.length, total: totalStars })

    // Group by date for daily history
    const starsByDate = new Map<string, number>()
    const starsByHour = new Map<string, number>()
    const sevenDaysAgo = new Date(today)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    allStargazers.forEach(sg => {
      if (sg.starred_at) {
        const date = sg.starred_at.split('T')[0]
        starsByDate.set(date, (starsByDate.get(date) || 0) + 1)
        
        // Hourly for last 7 days
        const starDate = new Date(sg.starred_at)
        if (starDate >= sevenDaysAgo) {
          const hourKey = sg.starred_at.slice(0, 13) + ':00:00Z' // Round to hour
          starsByHour.set(hourKey, (starsByHour.get(hourKey) || 0) + 1)
        }
      }
    })

    // Build complete daily history from repo creation to today
    const dailyHistory: { date: string; daily: number; cumulative: number }[] = []
    let cumulative = 0
    
    // Start from repo creation date
    for (let d = new Date(createdDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]
      const dailyStars = starsByDate.get(dateStr) || 0
      cumulative += dailyStars
      
      dailyHistory.push({
        date: dateStr,
        daily: dailyStars,
        cumulative,
      })
    }

    // If we don't have complete data, scale the cumulative to match total
    const dataCompleteness = totalStars > 0 ? (cumulative / totalStars) * 100 : 100
    
    // Scale cumulative values if we have incomplete data
    if (cumulative < totalStars && cumulative > 0) {
      const scaleFactor = totalStars / cumulative
      dailyHistory.forEach(d => {
        d.cumulative = Math.round(d.cumulative * scaleFactor)
      })
    }

    // Build hourly activity (last 7 days)
    const hourlyActivity: { hour: string; stars: number }[] = []
    for (let h = new Date(sevenDaysAgo); h <= today; h.setHours(h.getHours() + 1)) {
      const hourKey = h.toISOString().slice(0, 13) + ':00:00Z'
      hourlyActivity.push({
        hour: hourKey,
        stars: starsByHour.get(hourKey) || 0,
      })
    }

    // Calculate trends from daily history
    const last7 = dailyHistory.slice(-7)
    const last30 = dailyHistory.slice(-30)
    const prev30 = dailyHistory.slice(-60, -30)

    const sum7 = last7.reduce((a, b) => a + b.daily, 0)
    const sum30 = last30.reduce((a, b) => a + b.daily, 0)
    const sumPrev30 = prev30.reduce((a, b) => a + b.daily, 0)

    const avg7d = last7.length > 0 ? sum7 / last7.length : 0
    const avg30d = last30.length > 0 ? sum30 / last30.length : 0

    // Find peak day
    const peakDay = dailyHistory.reduce((max, day) => 
      day.daily > max.daily ? day : max, 
      { date: createdAt, daily: 0, cumulative: 0 }
    )

    // Trend detection
    let trend: 'up' | 'down' | 'stable' = 'stable'
    if (sumPrev30 > 0) {
      const change = (sum30 - sumPrev30) / sumPrev30
      if (change > 0.1) trend = 'up'
      else if (change < -0.1) trend = 'down'
    } else if (sum30 > 10) {
      trend = 'up'
    }

    // Growth rate (percentage change last 30 days)
    const startStars = last30.length > 0 ? last30[0].cumulative : totalStars
    const growthRate = startStars > 0 
      ? ((totalStars - startStars) / startStars) * 100 
      : 0

    logger.info('Star analytics computed', { 
      owner, 
      repo, 
      totalStars, 
      historyDays: dailyHistory.length,
      dataCompleteness: dataCompleteness.toFixed(1) + '%',
      avg7d: avg7d.toFixed(2),
      trend 
    })

    return {
      status: 200,
      body: {
        owner,
        repo,
        totalStars,
        createdAt,
        ageInDays,
        avgStarsPerDay: parseFloat(avgStarsPerDay.toFixed(2)),
        dailyHistory,
        hourlyActivity,
        trends: {
          avg7d: parseFloat(avg7d.toFixed(2)),
          avg30d: parseFloat(avg30d.toFixed(2)),
          peakDay: {
            date: peakDay.date,
            stars: peakDay.daily,
          },
          velocity: parseFloat(avg7d.toFixed(2)),
          trend,
          growthRate: parseFloat(growthRate.toFixed(2)),
        },
        recentActivity: last30,
        dataCompleteness: parseFloat(dataCompleteness.toFixed(1)),
      },
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to fetch star analytics', { error: message })
    
    if (message.includes('rate limit')) {
      return {
        status: 403,
        body: { error: 'GitHub API rate limit exceeded. Please provide a token.' },
      }
    }
    
    return {
      status: 500,
      body: { error: message },
    }
  }
}
