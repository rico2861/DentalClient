-- Salle d'attente numérotée : chaque personne qui arrive reçoit un numéro du jour (1, 2, 3…) dans l'ordre d'arrivée.
-- La secrétaire / l'assistant(e) voit qui est le premier, le suivant, appelle, fait entrer en consultation, termine.
-- Capacité : nombre maximal de personnes reçues par jour, du lundi au vendredi (les urgences restent toujours acceptées).
create table if not exists queue_tickets(
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id),
  day            date not null,
  number         int  not null check (number > 0),
  patient_id     uuid references patients(id),
  visitor_name   text,                               -- personne pas encore inscrite comme patient
  phone          text,
  appointment_id uuid references appointments(id),
  doctor_id      uuid references users(id),
  reason         text,
  priority       boolean not null default false,     -- urgence : passe en tête de file
  status         text not null default 'waiting' check (status in ('waiting', 'called', 'in_consult', 'done', 'absent', 'cancelled')),
  arrived_at     timestamptz not null default now(),
  called_at      timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_by     uuid references users(id),
  updated_by     uuid references users(id),
  unique (clinic_id, day, number),
  check (patient_id is not null or coalesce(trim(visitor_name), '') <> '')
);
create index if not exists queue_day on queue_tickets(clinic_id, day, status);
-- une même personne ne peut pas être deux fois dans la file en même temps
create unique index if not exists queue_one_active on queue_tickets(clinic_id, day, patient_id) where patient_id is not null and status in ('waiting', 'called', 'in_consult');
create unique index if not exists queue_one_appt on queue_tickets(appointment_id) where appointment_id is not null and status <> 'cancelled';

-- capacité par jour de semaine (1 = lundi … 5 = vendredi) ; 0 = pas de limite
alter table clinics add column if not exists queue_capacity jsonb not null default '{"1": 20, "2": 20, "3": 20, "4": 20, "5": 20}';
