-- Evaluations & Simulations: evaluation programs at every rank (working test periods and standalone forms),
-- enrolments, evaluator results (practice / formal / retest), written submissions, periodic reviews,
-- and voice simulations (fireground radio and leadership conversations) graded with the program's rubric.
CREATE TABLE IF NOT EXISTS eval_programs (
  id          uuid PRIMARY KEY,
  key         text UNIQUE,                         -- seed key (co-wtp, bc-wtp, ...); NULL for programs made in the app
  name        text NOT NULL,
  rank        text NOT NULL DEFAULT '',            -- who it's for: Firefighter, Driver/Operator, Lieutenant / Captain, ...
  kind        text NOT NULL DEFAULT 'form',        -- wtp (12-month working test period) | form (standalone evaluation)
  description text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}',         -- scale, pass rules, modules [{key,title,weight,quarter,competency,elements,guide}], reviews, outcomes
  active      boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 100,
  evaluators  jsonb NOT NULL DEFAULT '[]',         -- user ids authorized to evaluate with this program (besides Evaluations edit access)
  updated_by_name text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_candidates (           -- someone in a working test period
  id          uuid PRIMARY KEY,
  program_id  uuid NOT NULL REFERENCES eval_programs(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'active',      -- active | completed | extended | withdrawn
  evaluators  jsonb NOT NULL DEFAULT '[]',         -- user ids assigned to this candidate
  outcome     text NOT NULL DEFAULT '',            -- one of the program's outcomes, at the end
  outcome_note text NOT NULL DEFAULT '',
  outcome_by_name text NOT NULL DEFAULT '',
  outcome_at  timestamptz,
  outcome_signature text,
  created_by_name text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_candidates_user ON eval_candidates (user_id);

CREATE TABLE IF NOT EXISTS eval_results (
  id            uuid PRIMARY KEY,
  program_id    uuid NOT NULL REFERENCES eval_programs(id),
  user_id       uuid NOT NULL REFERENCES users(id),        -- the person evaluated
  candidate_id  uuid REFERENCES eval_candidates(id) ON DELETE SET NULL,
  kind          text NOT NULL DEFAULT 'formal',            -- practice | formal | retest
  modules       jsonb NOT NULL DEFAULT '[]',               -- module keys covered
  scores        jsonb NOT NULL DEFAULT '{}',               -- {moduleKey: [score per element | null]}
  comments      jsonb NOT NULL DEFAULT '{}',               -- {moduleKey: text}
  observations  text NOT NULL DEFAULT '',                  -- what the evaluator saw
  feedback      text NOT NULL DEFAULT '',                  -- feedback to the person
  ai            jsonb,                                     -- the assistant's draft {scores, feedback, flags}
  flags         jsonb NOT NULL DEFAULT '[]',               -- items to verify [{text, done}]
  eval_date     date NOT NULL DEFAULT CURRENT_DATE,
  status        text NOT NULL DEFAULT 'draft',             -- draft | final
  evaluator_id  uuid REFERENCES users(id),
  evaluator_name text NOT NULL DEFAULT '',
  signature     text,                                      -- evaluator's drawn signature (final)
  signed_at     timestamptz,
  ack_at        timestamptz,                               -- the person saw it
  ack_comment   text NOT NULL DEFAULT '',
  session_id    uuid,
  pct           numeric,                                   -- overall % (stored at finalize)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_results_user ON eval_results (user_id);
CREATE INDEX IF NOT EXISTS eval_results_candidate ON eval_results (candidate_id);

CREATE TABLE IF NOT EXISTS eval_submissions (
  id           uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES eval_candidates(id) ON DELETE CASCADE,
  module_key   text NOT NULL DEFAULT '',
  title        text NOT NULL DEFAULT '',
  body         text NOT NULL DEFAULT '',
  file_name    text NOT NULL DEFAULT '',
  file_mime    text NOT NULL DEFAULT '',
  file_data    bytea,
  submitted_by uuid REFERENCES users(id),
  submitted_by_name text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS eval_reviews (                 -- 3 / 6 / 9 / 12-month reviews
  id           uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES eval_candidates(id) ON DELETE CASCADE,
  month        int NOT NULL,
  summary      text NOT NULL DEFAULT '',
  achievements text NOT NULL DEFAULT '',
  deficiencies text NOT NULL DEFAULT '',
  goals        text NOT NULL DEFAULT '',
  improvement_plan boolean NOT NULL DEFAULT false,         -- a remediation / performance improvement plan was issued
  status       text NOT NULL DEFAULT 'draft',              -- draft | signed
  evaluator_id uuid REFERENCES users(id),
  evaluator_name text NOT NULL DEFAULT '',
  evaluator_signature text,
  signed_at    timestamptz,
  ack_signature text,
  ack_comment  text NOT NULL DEFAULT '',
  ack_at       timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, month)
);

CREATE TABLE IF NOT EXISTS sim_scenarios (
  id          uuid PRIMARY KEY,
  key         text UNIQUE,
  kind        text NOT NULL DEFAULT 'radio',       -- radio (fireground) | conversation (leadership)
  title       text NOT NULL,
  summary     text NOT NULL DEFAULT '',
  program_key text NOT NULL DEFAULT '',            -- linked rubric: eval_programs.key + module
  module_key  text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}',         -- briefing, setting, role, units, injects, persona, rubric, minutes
  active      boolean NOT NULL DEFAULT true,
  sort        int NOT NULL DEFAULT 100,
  updated_by_name text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sim_sessions (
  id           uuid PRIMARY KEY,
  scenario_id  uuid NOT NULL REFERENCES sim_scenarios(id),
  user_id      uuid NOT NULL REFERENCES users(id),   -- the officer running it
  mode         text NOT NULL DEFAULT 'practice',     -- practice | formal | retest
  evaluator_id uuid REFERENCES users(id),
  evaluator_name text NOT NULL DEFAULT '',
  candidate_id uuid REFERENCES eval_candidates(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'running',      -- running | ended | graded
  scenario     jsonb NOT NULL DEFAULT '{}',          -- snapshot of the scenario as run
  transcript   jsonb NOT NULL DEFAULT '[]',          -- [{t (sim seconds), who, from, text, kind}]
  state        jsonb NOT NULL DEFAULT '{}',          -- injects delivered, mood, ...
  grade        jsonb,                                -- the assistant's debrief
  result_id    uuid,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
CREATE INDEX IF NOT EXISTS sim_sessions_user ON sim_sessions (user_id, started_at DESC);
