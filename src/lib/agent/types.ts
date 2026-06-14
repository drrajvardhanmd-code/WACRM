// Successful auth result
export interface AgentAuthSuccess {
  userId: string          // The auth.users UUID this key belongs to
  apiKeyId: string        // The agent_api_keys UUID
  scopes: string[]        // Array of permission strings
  rateLimitRequests: number
  rateLimitWindowSeconds: number
  error?: undefined
  status?: undefined
}

// Failed auth result
export interface AgentAuthError {
  error: string           // Human-readable error message
  status: number          // HTTP status code (401 or 403)
  userId?: undefined
}

// Union type returned by authenticateAgent
export type AgentAuthResult = AgentAuthSuccess | AgentAuthError

// Standard paginated response wrapper
export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  per_page: number
  total_pages: number
}

// Standard error response
export interface ApiError {
  error: string
  detail?: string
}

// Pagination query parameters
export interface PaginationParams {
  page: number            // 1-indexed, default 1
  per_page: number        // default 20, max 100
}

// Search query parameters
export interface SearchParams extends PaginationParams {
  q: string               // Search query string
  sort_by?: string        // Column name
  sort_order?: 'asc' | 'desc'
}
