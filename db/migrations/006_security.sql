alter table clinics add column if not exists inactivity_logout_minutes int not null default 30 check (inactivity_logout_minutes between 1 and 480);
alter table users add column if not exists totp_secret_enc text, add column if not exists totp_pending_enc text, add column if not exists totp_enabled boolean not null default false, add column if not exists totp_last_step bigint;
alter table clinics add column if not exists require_2fa boolean not null default true;
create table if not exists recovery_codes(user_id uuid references users(id) on delete cascade, code_hash text not null, used_at timestamptz, primary key(user_id, code_hash));
create table if not exists user_sessions(id uuid primary key default gen_random_uuid(), user_id uuid not null references users(id) on delete cascade, ip inet, user_agent text, created_at timestamptz default now(), last_seen timestamptz default now(), revoked_at timestamptz);
create index if not exists sess_idx on user_sessions(user_id, last_seen desc);
create table if not exists login_history(id bigserial primary key, clinic_id uuid, user_id uuid, email text, success boolean not null, reason text, ip inet, user_agent text, created_at timestamptz default now());
create index if not exists lh_idx on login_history(clinic_id, id desc); create index if not exists lh_user on login_history(user_id, id desc);
drop trigger if exists t_lh on login_history; create trigger t_lh before update or delete on login_history for each row execute function forbid_mutation();
create table if not exists notifications(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), user_id uuid references users(id), perm text, kind text not null, title text not null, text text, created_at timestamptz default now());
create index if not exists notif_idx on notifications(clinic_id, created_at desc);
create table if not exists notification_reads(notification_id uuid references notifications(id) on delete cascade, user_id uuid references users(id) on delete cascade, primary key(notification_id, user_id));
create table if not exists patient_hygiene(patient_id uuid primary key references patients(id), clinic_id uuid not null, data jsonb not null default '{}', updated_by uuid references users(id), updated_at timestamptz default now());
create table if not exists dental_examinations(id uuid primary key default gen_random_uuid(), clinic_id uuid not null, patient_id uuid not null references patients(id), doctor_id uuid not null references users(id),
 examined_at timestamptz not null default now(), head text, face text, atm text, tongue text, periodontium text, tooth_morphology text, observations text);
create index if not exists exam_idx on dental_examinations(patient_id, examined_at desc);
drop trigger if exists t_exam on dental_examinations; create trigger t_exam before update or delete on dental_examinations for each row execute function forbid_mutation();
create table if not exists purchase_requests(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), requested_by uuid not null references users(id),
 status text not null default 'pending' check (status in ('pending','approved','rejected','ordered')), note text, decided_by uuid references users(id), decided_at timestamptz, decision_note text,
 purchase_id uuid references purchases(id), created_at timestamptz default now());
create table if not exists purchase_request_items(id uuid primary key default gen_random_uuid(), request_id uuid not null references purchase_requests(id), product_id uuid not null references products(id),
 qty numeric(12,3) not null check (qty>0), est_unit_price numeric(14,4) not null default 0 check (est_unit_price>=0));
