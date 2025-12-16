-- Chart configurations (saved chart setups)
CREATE TABLE chart_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL DEFAULT '1M',
  chart_type TEXT NOT NULL DEFAULT 'candlestick',
  indicators JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chart annotations (drawings, shapes, text)
CREATE TABLE chart_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID REFERENCES chart_configurations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- horizontal-line, vertical-line, trend-line, rectangle, ellipse, fibonacci, text, arrow
  data JSONB NOT NULL, -- coordinates, style, properties
  z_index INTEGER DEFAULT 0,
  visible BOOLEAN DEFAULT true,
  locked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chart events (custom markers on charts)
CREATE TABLE chart_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID REFERENCES chart_configurations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  event_time TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL, -- earnings, dividend, split, news, custom
  title TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shared charts
CREATE TABLE shared_charts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID REFERENCES chart_configurations(id) ON DELETE CASCADE,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token TEXT UNIQUE NOT NULL,
  share_type TEXT NOT NULL DEFAULT 'snapshot', -- 'snapshot' or 'live'
  saved_as_timestamp TIMESTAMPTZ, -- marker for live shares
  expires_at TIMESTAMPTZ,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chart templates (reusable setups)
CREATE TABLE chart_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  indicators JSONB DEFAULT '[]',
  drawing_tools JSONB DEFAULT '[]',
  settings JSONB DEFAULT '{}',
  is_public BOOLEAN DEFAULT false,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Custom data series (user-uploaded or calculated data)
CREATE TABLE custom_data_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  symbol TEXT, -- Optional, can be tied to a specific symbol
  description TEXT,
  data_type TEXT NOT NULL, -- 'line', 'bar', 'scatter', 'area'
  color TEXT DEFAULT '#2563eb',
  data JSONB NOT NULL, -- Array of {time, value} points
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_chart_configurations_user_id ON chart_configurations(user_id);
CREATE INDEX idx_chart_configurations_symbol ON chart_configurations(symbol);
CREATE INDEX idx_chart_annotations_chart_id ON chart_annotations(chart_id);
CREATE INDEX idx_chart_events_chart_id ON chart_events(chart_id);
CREATE INDEX idx_shared_charts_share_token ON shared_charts(share_token);
CREATE INDEX idx_chart_templates_is_public ON chart_templates(is_public);
CREATE INDEX idx_custom_data_series_user_id ON custom_data_series(user_id);
CREATE INDEX idx_custom_data_series_symbol ON custom_data_series(symbol);

-- Enable RLS
ALTER TABLE chart_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_data_series ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chart_configurations
CREATE POLICY "Users can view own charts" ON chart_configurations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own charts" ON chart_configurations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own charts" ON chart_configurations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own charts" ON chart_configurations
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for chart_annotations
CREATE POLICY "Users can view own annotations" ON chart_annotations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own annotations" ON chart_annotations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own annotations" ON chart_annotations
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own annotations" ON chart_annotations
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for chart_events
CREATE POLICY "Users can view own events" ON chart_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own events" ON chart_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own events" ON chart_events
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own events" ON chart_events
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for shared_charts
CREATE POLICY "Anyone can view shared charts by token" ON shared_charts
  FOR SELECT USING (true);

CREATE POLICY "Owners can manage shared charts" ON shared_charts
  FOR ALL USING (auth.uid() = owner_id);

-- RLS Policies for chart_templates
CREATE POLICY "Users can view own templates" ON chart_templates
  FOR SELECT USING (auth.uid() = user_id OR is_public = true);

CREATE POLICY "Users can create own templates" ON chart_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates" ON chart_templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates" ON chart_templates
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for custom_data_series
CREATE POLICY "Users can view own data series" ON custom_data_series
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own data series" ON custom_data_series
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own data series" ON custom_data_series
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own data series" ON custom_data_series
  FOR DELETE USING (auth.uid() = user_id);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_chart_configurations_updated_at
  BEFORE UPDATE ON chart_configurations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chart_annotations_updated_at
  BEFORE UPDATE ON chart_annotations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chart_templates_updated_at
  BEFORE UPDATE ON chart_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_data_series_updated_at
  BEFORE UPDATE ON custom_data_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
