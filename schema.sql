CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(80) NOT NULL,
  title VARCHAR(100) NOT NULL,
  subject VARCHAR(50) NOT NULL,
  due_date DATE NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS assignments_user_due_idx ON assignments(user_id, due_date);

CREATE TABLE IF NOT EXISTS study_sessions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id VARCHAR(80) NOT NULL,
  topic VARCHAR(90) NOT NULL,
  subject VARCHAR(50) NOT NULL,
  session_date DATE NOT NULL,
  session_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS study_sessions_user_date_idx ON study_sessions(user_id, session_date, session_time);
