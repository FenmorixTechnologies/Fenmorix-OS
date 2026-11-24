-- Strategies & Tactics: overhead pictures for simulation scenarios (uploaded, or USGS aerial imagery fetched by address).
-- The scene itself (scale, hydrants, building outline, fire, hazards, blocked areas, wind) lives in sim_scenarios.data.scene;
-- apparatus placements during a run live in sim_sessions.state.placements.
CREATE TABLE IF NOT EXISTS sim_images (
  id          uuid PRIMARY KEY,
  name        text NOT NULL DEFAULT '',
  mime        text NOT NULL,
  data        bytea NOT NULL,
  width       int NOT NULL,
  height      int NOT NULL,
  ft_per_px   double precision,                  -- known scale (USGS imagery); NULL until set by hand
  source      text NOT NULL DEFAULT 'upload',    -- upload | usgs
  attribution text NOT NULL DEFAULT '',
  lat         double precision,
  lon         double precision,
  created_by_name text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
