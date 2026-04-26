-- Single RPC backing the Outcomes reflections panel. Replaces the prior
-- 5-call sequential pattern (lookup accepted_trade → lookup
-- decision_request → fetch accepted_trade_comments → fetch
-- decision_request_comments → fetch user display names) with one
-- round-trip. Identical visibility through RLS — every inner SELECT
-- runs as the calling user.
--
-- Shape of the return JSONB:
--   {
--     reflections: [{ id, content, user_id, user_name, created_at, source }],
--     acceptedTradeId: uuid | null,
--     decisionRequestId: uuid | null
--   }
--
-- Field names match the Reflection TS type so the frontend hook can
-- pass the array straight through without rekeying.

CREATE OR REPLACE FUNCTION public.decision_reflections_payload(p_decision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_accepted_trade_id UUID;
  v_decision_request_id UUID;
  v_reflections JSONB;
BEGIN
  IF p_decision_id IS NULL THEN
    RETURN jsonb_build_object(
      'reflections', '[]'::jsonb,
      'acceptedTradeId', NULL,
      'decisionRequestId', NULL
    );
  END IF;

  -- An accountability row's decision_id is polymorphic — it may match
  -- a trade_queue_item, an accepted_trade, or a decision_request.
  -- Resolve both the accepted_trade and the decision_request linked to
  -- it (either side may be the owner of the comment thread).
  SELECT id INTO v_accepted_trade_id
  FROM accepted_trades
  WHERE (id = p_decision_id OR trade_queue_item_id = p_decision_id)
    AND is_active = TRUE
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT id INTO v_decision_request_id
  FROM decision_requests
  WHERE id = p_decision_id
     OR trade_queue_item_id = p_decision_id
     OR accepted_trade_id = v_accepted_trade_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- UNION the two comment streams. Display name resolved via a single
  -- LEFT JOIN to public.users, falling back to email if no name fields.
  -- Note: comments tables use `user_id` (not `created_by`) for the
  -- author column.
  WITH r AS (
    SELECT
      atc.id,
      atc.content,
      atc.user_id,
      atc.created_at,
      COALESCE(
        NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.email,
        'Unknown'
      ) AS user_name,
      'accepted_trade'::text AS source
    FROM accepted_trade_comments atc
    LEFT JOIN users u ON u.id = atc.user_id
    WHERE v_accepted_trade_id IS NOT NULL
      AND atc.accepted_trade_id = v_accepted_trade_id
      AND atc.content IS NOT NULL
      AND btrim(atc.content) <> ''

    UNION ALL

    SELECT
      drc.id,
      drc.content,
      drc.user_id,
      drc.created_at,
      COALESCE(
        NULLIF(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        u.email,
        'Unknown'
      ) AS user_name,
      'decision_request'::text AS source
    FROM decision_request_comments drc
    LEFT JOIN users u ON u.id = drc.user_id
    WHERE v_decision_request_id IS NOT NULL
      AND drc.decision_request_id = v_decision_request_id
      AND drc.content IS NOT NULL
      AND btrim(drc.content) <> ''
  )
  SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.created_at ASC) INTO v_reflections
  FROM r;

  RETURN jsonb_build_object(
    'reflections', COALESCE(v_reflections, '[]'::jsonb),
    'acceptedTradeId', v_accepted_trade_id,
    'decisionRequestId', v_decision_request_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decision_reflections_payload(uuid) TO authenticated;
