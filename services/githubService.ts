import { RepoInfo, RepoData } from '../types'

// Motia backend base URL
// In production (Vercel), use relative URLs so it goes through the proxy
// In development, use localhost
const isProduction = import.meta.env.PROD
const API_BASE = isProduction ? '' : 'http://localhost:3001'

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
