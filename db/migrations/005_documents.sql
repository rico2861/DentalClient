create table if not exists documents(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 kind text not null check (kind in ('radiographie','photo','pdf','ordonnance','devis','consentement','plan_signe')), original_name text not null, mime text not null, size int not null,
 sha256 text not null, storage_key text not null unique, uploaded_by uuid references users(id), created_at timestamptz default now(), archived_at timestamptz);
create index if not exists docs_idx on documents(patient_id, created_at desc);
create table if not exists patient_consents(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), patient_id uuid not null references patients(id),
 kind text not null check (kind in ('treatment_consent','prosthesis_quote','treatment_plan','intervention_authorization')), plan_id uuid references treatment_plans(id), prosthesis_id uuid references prostheses(id),
 body text not null, signer_name text not null, signature bytea not null, collected_by uuid not null references users(id), signed_at timestamptz not null default now(), integrity_hash text not null);
drop trigger if exists t_cons on patient_consents; create trigger t_cons before update or delete on patient_consents for each row execute function forbid_mutation();
drop trigger if exists t_docdel on documents; create trigger t_docdel before delete on documents for each row execute function forbid_mutation();
