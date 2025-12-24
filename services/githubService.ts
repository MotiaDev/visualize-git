import { RepoInfo, RepoData } from '../types'

// Vite environment variables
declare const import_meta_env: { PROD: boolean; VITE_API_PORT?: string }

// Motia backend base URL
// In production (Vercel), use relative URLs so it goes through the proxy
// In development, use localhost
const isProduction = (import.meta as unknown as { env: typeof import_meta_env }).env.PROD
// Motia dev server runs on 3000 by default, but may use 3001 if 3000 is busy
const DEV_PORT = (import.meta as unknown as { env: typeof import_meta_env }).env.VITE_API_PORT || '3001'
const API_BASE = isProduction ? '' : `http://localhost:${DEV_PORT}`

export const fetchRepoDetails = async (
  owner: string,
  repo: string,
  token?: string
): Promise<RepoInfo> => {
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }

  const url = `${API_BASE}/api/github/repo/${owner}/${repo}${params.toString() ? `?${params}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch repository details')
  }

  const data = await response.json()
  
  // Handle both raw GitHub API format and our transformed format
  // This ensures compatibility if Motia Cloud has an older deployment
  return {
    name: data.name,
    fullName: data.fullName || data.full_name || `${owner}/${repo}`,
    description: data.description || '',
    stars: data.stars ?? data.stargazers_count ?? 0,
    forks: data.forks ?? data.forks_count ?? 0,
    language: data.language || '',
    defaultBranch: data.defaultBranch || data.default_branch || 'main',
    url: data.url || data.html_url || `https://github.com/${owner}/${repo}`,
    owner: {
      login: data.owner?.login || owner,
      avatar: data.owner?.avatar || data.owner?.avatar_url || '',
    },
  }
}

export const fetchRepoTree = async (
  owner: string,
  repo: string,
  defaultBranch: string = 'main',
  token?: string
): Promise<RepoData> => {
  const params = new URLSearchParams()
  params.set('branch', defaultBranch)
  if (token) {
    params.set('token', token)
  }

  const url = `${API_BASE}/api/github/tree/${owner}/${repo}?${params}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch repository tree')
  }

  return response.json()
}

export const watchRepo = async (
  owner: string,
  repo: string,
  token?: string
): Promise<{ success: boolean; message: string; watchId: string }> => {
  const response = await fetch(`${API_BASE}/api/github/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, repo, token }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to start watching repository')
  }

  return response.json()
}

// WebSocket URL for streams
// Note: WebSocket streaming is only available in local development
// In production, Vercel serverless doesn't support persistent WebSocket connections
export const getStreamUrl = (watchId: string) => {
  if (isProduction) {
    // Return null to indicate streaming is not available
    return null
  }
  // Convert http:// to ws:// 
  const wsBase = API_BASE.replace(/^http/, 'ws')
  return `${wsBase}/__streams/repoUpdates?groupId=${encodeURIComponent(watchId)}`
}

export interface RepoUpdate {
  id: string
  owner: string
  repo: string
  type: 'commit' | 'push' | 'branch' | 'refresh'
  message: string
  author?: string
  sha?: string
  timestamp: string
  nodeCount?: number
  linkCount?: number
}

export const subscribeToRepoUpdates = (
  watchId: string,
  onUpdate: (update: RepoUpdate) => void,
  onError?: (error: Event) => void
): (() => void) => {
  const wsUrl = getStreamUrl(watchId)
  
  // In production, WebSocket streaming is not available
  if (!wsUrl) {
    console.log('WebSocket streaming not available in production')
    return () => {} // Return no-op cleanup function
  }
  
  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'update' || data.type === 'new-commit') {
        onUpdate(data.data || data)
      }
    } catch (e) {
      console.error('Failed to parse stream message:', e)
    }
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
    onError?.(error)
  }

  ws.onclose = () => {
    console.log('WebSocket closed for', watchId)
  }

  return () => {
    ws.close()
  }
}

export interface StarHistoryData {
  owner: string
  repo: string
  totalStars: number
  history: { date: string; stars: number }[]
}

export const fetchStarHistory = async (
  owner: string,
  repo: string,
  token?: string
): Promise<StarHistoryData> => {
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }

  const url = `${API_BASE}/api/github/stars/${owner}/${repo}${params.toString() ? `?${params}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch star history')
  }

  return response.json()
}

// Commit history for timeline animation
export interface CommitFile {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed'
  additions: number
  deletions: number
}

export interface CommitData {
  sha: string
  message: string
  date: string
  author: {
    name: string
    email: string
    avatar: string
  }
  files: CommitFile[]
}

export interface CommitsResponse {
  commits: CommitData[]
  total: number
  hasMore: boolean
}

export const fetchCommits = async (
  owner: string,
  repo: string,
  token?: string,
  perPage: number = 100,
  page: number = 1
): Promise<CommitsResponse> => {
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  params.set('perPage', perPage.toString())
  params.set('page', page.toString())

  const url = `${API_BASE}/api/github/commits/${owner}/${repo}?${params}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch commits')
  }

  return response.json()
}

// Star Analytics - daily breakdown and trends
export interface DailyStar {
  date: string
  daily: number // Stars gained that day
  cumulative: number // Total stars up to that day
}

export interface HourlyStar {
  hour: string // ISO timestamp for the hour
  stars: number
}

export interface StarTrends {
  avg7d: number
  avg30d: number
  peakDay: { date: string; stars: number }
  velocity: number
  trend: 'up' | 'down' | 'stable'
  growthRate: number // Percentage growth last 30d
}

export interface StarAnalytics {
  owner: string
  repo: string
  totalStars: number
  createdAt: string
  ageInDays: number
  avgStarsPerDay: number
  dailyHistory: DailyStar[] // Complete history from repo creation
  hourlyActivity: HourlyStar[] // Last 7 days hourly
  trends: StarTrends
  recentActivity: DailyStar[] // Last 30 days
  dataCompleteness: number // Percentage of stars we have dates for
}

export const fetchStarAnalytics = async (
  owner: string,
  repo: string,
  token?: string,
  fullHistory: boolean = false
): Promise<StarAnalytics> => {
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }
  if (fullHistory) {
    params.set('full', 'true')
  }

  const url = `${API_BASE}/api/github/star-analytics/${owner}/${repo}?${params}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch star analytics')
  }

  return response.json()
}

// Contribution stats (PRs, issues, reviews, activity patterns)
export interface ContributionStats {
  totalCommits: number
  totalPullRequests: number
  totalIssues: number
  totalReviews: number
  activityPatterns: {
    busiestDay: { day: string; count: number }
    peakHours: { hour: number; count: number }[]
    peakMonth: { month: string; count: number }
    weekdayDistribution: { day: string; count: number }[]
    hourlyDistribution: { hour: number; count: number }[]
  }
  topContributors: {
    login: string
    avatar: string
    commits: number
    pullRequests: number
    issues: number
  }[]
  recentCommitters: {
    login: string
    avatar: string
    commits: number
    lastCommitDate: string
  }[]
}

export const fetchContributions = async (
  owner: string,
  repo: string,
  token?: string
): Promise<ContributionStats> => {
  const params = new URLSearchParams()
  if (token) {
    params.set('token', token)
  }

  const url = `${API_BASE}/api/github/contributions/${owner}/${repo}?${params}`
  const response = await fetch(url)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || 'Failed to fetch contributions')
  }

  return response.json()
}
