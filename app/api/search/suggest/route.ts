import { NextRequest, NextResponse } from 'next/server'
import { SpatialService } from '@/lib/api/spatial.service'
import { SearchSuggestSchema } from '@/lib/api/validation'
import { CacheService } from '@/lib/api/cache.service'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const rawQuery = {
      q: searchParams.get('q') || '',
      limit: searchParams.get('limit') || 5
    }

    // Zod validation
    const query = SearchSuggestSchema.safeParse(rawQuery)
    if (!query.success) {
      return NextResponse.json({ error: 'Invalid search parameters', details: query.error.format() }, { status: 400 })
    }

    // Call Spatial/Search Service (uses PostGIS pg_trgm fuzzy matching behind the scenes)
    const suggestions = await SpatialService.searchStops(query.data.q, query.data.limit)

    return NextResponse.json(
      { 
        suggestions,
        metadata: {
          totalCount: suggestions.length,
          query: query.data.q
        }
      },
      { headers: CacheService.suggestionHeaders() }
    )
  } catch (error) {
    console.error('Search API Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
