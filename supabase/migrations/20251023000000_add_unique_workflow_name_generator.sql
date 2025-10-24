/*
  # Add unique workflow name generation

  1. Functions
    - generate_unique_workflow_name: Generates a unique workflow name with dynamic suffix processing
    - process_dynamic_suffix: Processes dynamic placeholders like {Q}, {YEAR}, etc.

  This ensures that when automation rules trigger and copy workflows,
  the new workflow names are always unique.
*/

-- Function to process dynamic suffixes
CREATE OR REPLACE FUNCTION process_dynamic_suffix(suffix text)
RETURNS text AS $$
DECLARE
  current_quarter int;
  current_year int;
  current_month text;
  quarter_start_month text;
  quarter_end_month text;
  processed_suffix text;
BEGIN
  IF suffix IS NULL OR suffix = '' THEN
    RETURN '';
  END IF;

  -- Get current date components
  current_quarter := EXTRACT(QUARTER FROM CURRENT_DATE);
  current_year := EXTRACT(YEAR FROM CURRENT_DATE);
  current_month := TO_CHAR(CURRENT_DATE, 'Mon');

  -- Get quarter start and end months
  quarter_start_month := CASE current_quarter
    WHEN 1 THEN 'Jan'
    WHEN 2 THEN 'Apr'
    WHEN 3 THEN 'Jul'
    WHEN 4 THEN 'Oct'
  END;

  quarter_end_month := CASE current_quarter
    WHEN 1 THEN 'Mar'
    WHEN 2 THEN 'Jun'
    WHEN 3 THEN 'Sep'
    WHEN 4 THEN 'Dec'
  END;

  -- Process all placeholders
  processed_suffix := suffix;
  processed_suffix := REPLACE(processed_suffix, '{Q}', current_quarter::text);
  processed_suffix := REPLACE(processed_suffix, '{QUARTER}', 'Q' || current_quarter::text);
  processed_suffix := REPLACE(processed_suffix, '{YEAR}', current_year::text);
  processed_suffix := REPLACE(processed_suffix, '{YY}', RIGHT(current_year::text, 2));
  processed_suffix := REPLACE(processed_suffix, '{MONTH}', current_month);
  processed_suffix := REPLACE(processed_suffix, '{START_MONTH}', quarter_start_month);
  processed_suffix := REPLACE(processed_suffix, '{END_MONTH}', quarter_end_month);

  RETURN processed_suffix;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to generate unique workflow name
CREATE OR REPLACE FUNCTION generate_unique_workflow_name(
  base_name text,
  suffix text,
  user_id uuid DEFAULT NULL
)
RETURNS text AS $$
DECLARE
  processed_suffix text;
  full_name text;
  final_name text;
  counter int;
  name_exists boolean;
BEGIN
  -- Process dynamic suffix
  processed_suffix := process_dynamic_suffix(suffix);

  -- Construct full name
  IF processed_suffix IS NOT NULL AND processed_suffix != '' THEN
    full_name := base_name || ' - ' || processed_suffix;
  ELSE
    full_name := base_name;
  END IF;

  -- Check if name exists
  SELECT EXISTS (
    SELECT 1 FROM workflows
    WHERE name = full_name
    AND (user_id IS NULL OR created_by = user_id OR is_public = true)
  ) INTO name_exists;

  -- If name doesn't exist, return it
  IF NOT name_exists THEN
    RETURN full_name;
  END IF;

  -- Otherwise, find unique name by adding counter
  counter := 2;
  LOOP
    final_name := full_name || ' (' || counter::text || ')';

    SELECT EXISTS (
      SELECT 1 FROM workflows
      WHERE name = final_name
      AND (user_id IS NULL OR created_by = user_id OR is_public = true)
    ) INTO name_exists;

    -- If this name doesn't exist, we found our unique name
    IF NOT name_exists THEN
      RETURN final_name;
    END IF;

    counter := counter + 1;

    -- Safety check to prevent infinite loop
    IF counter > 1000 THEN
      RETURN full_name || ' (' || gen_random_uuid()::text || ')';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION process_dynamic_suffix(text) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_unique_workflow_name(text, text, uuid) TO authenticated;

-- Comment the functions
COMMENT ON FUNCTION process_dynamic_suffix IS 'Processes dynamic placeholders in workflow name suffixes (e.g., {Q}, {YEAR})';
COMMENT ON FUNCTION generate_unique_workflow_name IS 'Generates a unique workflow name by processing dynamic suffixes and adding counters if needed';
