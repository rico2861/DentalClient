-- Horaires d'ouverture par jour de la semaine : {"1":{"open":"08:00","close":"17:00"}, "0":null, …} (null = fermé)
alter table clinics add column if not exists hours jsonb;
-- Médecins en service : plages horaires par jour de la semaine (0 = dimanche … 6 = samedi), plusieurs plages possibles
create table if not exists doctor_schedules(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id), doctor_id uuid not null references users(id),
  weekday smallint not null check (weekday between 0 and 6), start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at timestamptz default now(), check (start_time < end_time));
create index if not exists doctor_schedules_doc on doctor_schedules(doctor_id, weekday);
-- Adresses e-mail uniques sans tenir compte des majuscules ni des espaces (si aucun doublon n'existe déjà)
update users set email = lower(trim(email)) where email <> lower(trim(email)) and not exists (select 1 from users u2 where u2.id <> users.id and lower(trim(u2.email)) = lower(trim(users.email)));
do $$ begin
  if not exists (select lower(trim(email)) from users group by 1 having count(*) > 1) then
    create unique index if not exists users_email_ci_uq on users (lower(trim(email)));
  end if; end $$;
