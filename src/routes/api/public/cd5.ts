import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/cd5')({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        const { data, error } = await supabaseAdmin
          .from('cd5_snapshots')
          .select('cp, provincia, count, updated_at')
          .order('count', { ascending: false })

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          )
        }

        return new Response(JSON.stringify(data ?? []), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
          },
        })
      },
    },
  },
})
