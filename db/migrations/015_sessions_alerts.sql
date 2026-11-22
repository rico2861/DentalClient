-- Interventions des plans : statut « reportée » et traitements en plusieurs séances (réalisées / prévues).
alter table treatment_plan_items drop constraint if exists treatment_plan_items_status_check;
alter table treatment_plan_items drop constraint if exists treatment_plan_items_status_ok;
alter table treatment_plan_items add constraint treatment_plan_items_status_ok check (status in ('todo','in_progress','postponed','done','cancelled'));
alter table treatment_plan_items add column if not exists sessions_planned int not null default 1, add column if not exists sessions_done int not null default 0, add column if not exists postponed_reason text;
alter table treatment_plan_items drop constraint if exists tpi_sessions_ok;
alter table treatment_plan_items add constraint tpi_sessions_ok check (sessions_planned between 1 and 60 and sessions_done >= 0);
-- Documents et images rattachés à une intervention
alter table documents add column if not exists consultation_id uuid references consultations(id);
-- Notifications automatiques : une seule alerte par sujet (clé de déduplication)
alter table notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_uq on notifications(clinic_id, dedupe_key) where dedupe_key is not null;
