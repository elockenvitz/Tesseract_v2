/*
  # Add {DATE} and {DAY} placeholder support

  Updates the process_dynamic_suffix function to support:
  - {DATE} - Full formatted date like "Oct 23 2025"
  - {DAY} - Day of month like "23"
*/

-- Update process_dynamic_suffix function to add {DATE} and {DAY} support
CREATE OR REPLACE FUNCTION process_dynamic_suffix(suffix text)
RETURNS text AS $$
DECLARE
  current_quarter int;
  current_year int;
  current_month text;
  current_day int;
  formatted_date text;
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
  current_day := EXTRACT(DAY FROM CURRENT_DATE);
  formatted_date := current_month || ' ' || current_day || ' ' || current_year;

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
  processed_suffix := REPLACE(processed_suffix, '{DATE}', formatted_date);
  processed_suffix := REPLACE(processed_suffix, '{DAY}', current_day::text);

  RETURN processed_suffix;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION process_dynamic_suffix IS 'Processes dynamic placeholders in workflow name suffixes (e.g., {Q}, {YEAR}, {DATE}, {DAY})';
