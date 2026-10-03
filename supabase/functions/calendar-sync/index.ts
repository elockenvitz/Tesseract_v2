import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requirePublishableKey } from "../_shared/publishable-key.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      requirePublishableKey((n) => Deno.env.get(n)),
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { connectionId, syncType = 'incremental' } = await req.json();

    // Get the connection
    const { data: connection, error: connError } = await supabaseClient
      .from('calendar_connections')
      .select(`
        *,
        connected_calendars (*)
      `)
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: 'Connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if token needs refresh
    let accessToken = connection.access_token;
    if (connection.token_expires_at && new Date(connection.token_expires_at) < new Date()) {
      accessToken = await refreshToken(supabaseClient, connection);
    }

    // Log sync start
    const { data: syncLog } = await supabaseClient
      .from('calendar_sync_logs')
      .insert({
        connection_id: connectionId,
        sync_type: syncType,
        status: 'started',
      })
      .select()
      .single();

    let eventsCreated = 0;
    let eventsUpdated = 0;
    let eventsDeleted = 0;

    try {
      // Get enabled calendars
      const enabledCalendars = connection.connected_calendars.filter((c: any) => c.sync_enabled);

      for (const calendar of enabledCalendars) {
        if (connection.provider === 'google') {
          const result = await syncGoogleCalendar(supabaseClient, user.id, connection, calendar, accessToken, syncType);
          eventsCreated += result.created;
          eventsUpdated += result.updated;
          eventsDeleted += result.deleted;
        } else if (connection.provider === 'microsoft') {
          const result = await syncMicrosoftCalendar(supabaseClient, user.id, connection, calendar, accessToken, syncType);
          eventsCreated += result.created;
          eventsUpdated += result.updated;
          eventsDeleted += result.deleted;
        }
      }

      // Update connection last_synced_at
      await supabaseClient
        .from('calendar_connections')
        .update({ last_synced_at: new Date().toISOString(), sync_error: null })
        .eq('id', connectionId);

      // Complete sync log
      await supabaseClient
        .from('calendar_sync_logs')
        .update({
          status: 'completed',
          events_created: eventsCreated,
          events_updated: eventsUpdated,
          events_deleted: eventsDeleted,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLog?.id);

      return new Response(
        JSON.stringify({ success: true, eventsCreated, eventsUpdated, eventsDeleted }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (syncError: any) {
      // Update connection with error
      await supabaseClient
        .from('calendar_connections')
        .update({ sync_error: syncError.message })
        .eq('id', connectionId);

      // Update sync log
      await supabaseClient
        .from('calendar_sync_logs')
        .update({
          status: 'failed',
          error_message: syncError.message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', syncLog?.id);

      throw syncError;
    }

  } catch (error: any) {
    console.error('Sync error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function refreshToken(supabase: any, connection: any): Promise<string> {
  if (!connection.refresh_token) {
    throw new Error('No refresh token available');
  }

  let tokenUrl: string;
  let body: URLSearchParams;

  if (connection.provider === 'google') {
    tokenUrl = 'https://oauth2.googleapis.com/token';
    body = new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID') || '',
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') || '',
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    });
  } else if (connection.provider === 'microsoft') {
    tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    body = new URLSearchParams({
      client_id: Deno.env.get('MICROSOFT_CLIENT_ID') || '',
      client_secret: Deno.env.get('MICROSOFT_CLIENT_SECRET') || '',
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    });
  } else {
    throw new Error('Unknown provider');
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token');
  }

  const tokens = await response.json();

  // Update stored tokens
  await supabase
    .from('calendar_connections')
    .update({
      access_token: tokens.access_token,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
    })
    .eq('id', connection.id);

  return tokens.access_token;
}

async function syncGoogleCalendar(
  supabase: any,
  userId: string,
  connection: any,
  calendar: any,
  accessToken: string,
  syncType: string
) {
  let created = 0, updated = 0, deleted = 0;

  // Fetch events from Google
  const timeMin = new Date();
  timeMin.setMonth(timeMin.getMonth() - 1); // 1 month ago
  const timeMax = new Date();
  timeMax.setMonth(timeMax.getMonth() + 6); // 6 months ahead

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.external_calendar_id)}/events?` +
    `timeMin=${timeMin.toISOString()}` +
    `&timeMax=${timeMax.toISOString()}` +
    `&singleEvents=true` +
    `&maxResults=250`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google events: ${response.statusText}`);
  }

  const data = await response.json();
  const events = data.items || [];

  for (const event of events) {
    if (event.status === 'cancelled') continue;

    // Check if event already exists
    const { data: existing } = await supabase
      .from('external_calendar_events')
      .select('id, calendar_event_id')
      .eq('connected_calendar_id', calendar.id)
      .eq('external_event_id', event.id)
      .single();

    const eventData = {
      title: event.summary || 'Untitled Event',
      description: event.description || null,
      start_date: event.start?.dateTime || event.start?.date,
      end_date: event.end?.dateTime || event.end?.date,
      all_day: !event.start?.dateTime,
      location: event.location || null,
      url: event.htmlLink || null,
      event_type: 'meeting' as const,
      priority: 'medium' as const,
      status: 'scheduled' as const,
      created_by: userId,
    };

    if (existing?.calendar_event_id) {
      // Update existing event
      await supabase
        .from('calendar_events')
        .update(eventData)
        .eq('id', existing.calendar_event_id);
      updated++;
    } else {
      // Create new event
      const { data: newEvent } = await supabase
        .from('calendar_events')
        .insert(eventData)
        .select()
        .single();

      if (newEvent) {
        await supabase
          .from('external_calendar_events')
          .insert({
            calendar_event_id: newEvent.id,
            connected_calendar_id: calendar.id,
            external_event_id: event.id,
            external_ical_uid: event.iCalUID,
            external_updated_at: event.updated,
            raw_event_data: event,
          });
        created++;
      }
    }
  }

  return { created, updated, deleted };
}

async function syncMicrosoftCalendar(
  supabase: any,
  userId: string,
  connection: any,
  calendar: any,
  accessToken: string,
  syncType: string
) {
  let created = 0, updated = 0, deleted = 0;

  const startDateTime = new Date();
  startDateTime.setMonth(startDateTime.getMonth() - 1);
  const endDateTime = new Date();
  endDateTime.setMonth(endDateTime.getMonth() + 6);

  const url = `https://graph.microsoft.com/v1.0/me/calendars/${calendar.external_calendar_id}/events?` +
    `$filter=start/dateTime ge '${startDateTime.toISOString()}' and end/dateTime le '${endDateTime.toISOString()}'` +
    `&$top=250`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Microsoft events: ${response.statusText}`);
  }

  const data = await response.json();
  const events = data.value || [];

  for (const event of events) {
    if (event.isCancelled) continue;

    const { data: existing } = await supabase
      .from('external_calendar_events')
      .select('id, calendar_event_id')
      .eq('connected_calendar_id', calendar.id)
      .eq('external_event_id', event.id)
      .single();

    const eventData = {
      title: event.subject || 'Untitled Event',
      description: event.bodyPreview || null,
      start_date: event.start?.dateTime ? new Date(event.start.dateTime + 'Z').toISOString() : null,
      end_date: event.end?.dateTime ? new Date(event.end.dateTime + 'Z').toISOString() : null,
      all_day: event.isAllDay || false,
      location: event.location?.displayName || null,
      url: event.webLink || null,
      event_type: 'meeting' as const,
      priority: 'medium' as const,
      status: 'scheduled' as const,
      created_by: userId,
    };

    if (existing?.calendar_event_id) {
      await supabase
        .from('calendar_events')
        .update(eventData)
        .eq('id', existing.calendar_event_id);
      updated++;
    } else {
      const { data: newEvent } = await supabase
        .from('calendar_events')
        .insert(eventData)
        .select()
        .single();

      if (newEvent) {
        await supabase
          .from('external_calendar_events')
          .insert({
            calendar_event_id: newEvent.id,
            connected_calendar_id: calendar.id,
            external_event_id: event.id,
            external_ical_uid: event.iCalUId,
            external_updated_at: event.lastModifiedDateTime,
            raw_event_data: event,
          });
        created++;
      }
    }
  }

  return { created, updated, deleted };
}
