PRAGMA foreign_keys = ON;

-- Tenants / firmy (универсальность)
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Пользователи (логины)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager','employee')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, email),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Профиль сотрудника
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  contract_hours_per_week REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, user_id),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Периоды планирования (месяц)
CREATE TABLE IF NOT EXISTS schedule_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  status TEXT NOT NULL CHECK (status IN ('draft','published')) DEFAULT 'draft',
  created_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, year, month),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

-- Типы смен (утро/день/ночь)
CREATE TABLE IF NOT EXISTS shift_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  start_time TEXT NOT NULL, -- '08:00'
  end_time TEXT NOT NULL,   -- '16:00'
  UNIQUE(company_id, name),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- Смены в конкретный день (и required headcount)
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  shift_type_id INTEGER NOT NULL,
  start_datetime TEXT NOT NULL, -- ISO: '2026-01-05T08:00:00'
  end_datetime TEXT NOT NULL,
  required_headcount INTEGER NOT NULL CHECK (required_headcount >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES schedule_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_type_id) REFERENCES shift_types(id) ON DELETE RESTRICT
);

-- Доступность (availability) сотрудников (окна времени)
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (period_id) REFERENCES schedule_periods(id) ON DELETE CASCADE
);

-- Назначения сотрудников на смены
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  shift_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  assigned_by_user_id INTEGER,
  source TEXT NOT NULL CHECK (source IN ('manual','auto')) DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shift_id, employee_id),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
);

-- Запросы на замену
CREATE TABLE IF NOT EXISTS swap_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  assignment_id INTEGER NOT NULL,
  requested_by_employee_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','accepted','rejected','cancelled')) DEFAULT 'open',
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Индексы (важно для диплома)
CREATE INDEX IF NOT EXISTS idx_shifts_period ON shifts(period_id);
CREATE INDEX IF NOT EXISTS idx_availability_period_emp ON availability(period_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_shift ON assignments(shift_id);
