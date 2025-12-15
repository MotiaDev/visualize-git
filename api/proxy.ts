// Vercel Serverless Function - Proxy all API requests to Motia backend
// This keeps the Motia backend URL private and secure

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Get the Motia backend URL from environment variable
  const MOTIA_BACKEND = process.env.MOTIA_BACKEND_URL || process.env.VITE_API_BASE
  
  if (!MOTIA_BACKEND) {
    return res.status(500).json({ 
      error: 'Backend URL not configured',
      message: 'Set MOTIA_BACKEND_URL environment variable in Vercel'
    })
  }
  
  // Extract the API path from the request
  // URL will be like: /api/github/repo/owner/repo
  // We want to forward to: https://backend.motia.cloud/api/github/repo/owner/repo
  const apiPath = req.url || ''
  
  // Build the backend URL
  const backendUrl = `${MOTIA_BACKEND}${apiPath}`
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  try {
    // Forward the request to Motia backend
    const response = await fetch(backendUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GitGalaxy-Vercel-Proxy',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    })
    
    // Get response as text first to inspect it
    const responseText = await response.text()
    const contentType = response.headers.get('content-type') || ''
    
    // Check if it's SVG (by content-type OR by content starting with <svg)
    const isSvg = contentType.includes('svg') || responseText.trim().startsWith('<svg')
    
    if (isSvg) {
      res.setHeader('Content-Type', 'image/svg+xml')
      res.setHeader('Cache-Control', 'public, max-age=3600') // Cache for 1 hour
      return res.status(response.status).send(responseText)
    }
    
    // For JSON responses, parse the text
    try {
      const data = JSON.parse(responseText)
      return res.status(response.status).json(data)
    } catch {
      // If it's not valid JSON, return as text
      return res.status(response.status).send(responseText)
    }
    
  } catch (error) {
    console.error('Proxy error:', error)
    return res.status(500).json({ 
      error: 'Failed to proxy request to backend',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

