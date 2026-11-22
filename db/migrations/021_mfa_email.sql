-- Double authentification par e-mail et codes d'accès à usage unique (délivrés par la direction, utilisables sans Internet)
alter table users add column if not exists mfa_email boolean not null default false;
create table if not exists login_codes(id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id), kind text not null check (kind in ('email','setup','owner')),
  code_hash text not null, expires_at timestamptz not null, attempts int not null default 0, used_at timestamptz, created_by uuid references users(id), created_at timestamptz default now());
create index if not exists login_codes_user on login_codes(user_id, created_at desc);
-- Serveur d'envoi des e-mails (SMTP) de la clinique ; le mot de passe est chiffré
alter table clinics add column if not exists smtp jsonb;
