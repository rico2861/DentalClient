-- Parcours du patient le jour du rendez-vous : arrivée, installation au fauteuil, fin (mesure réelle de l'attente et des durées)
alter table appointments add column if not exists arrived_at timestamptz, add column if not exists seated_at timestamptz, add column if not exists finished_at timestamptz;
-- Paramètres opérationnels de la clinique (horaires, jours ouvrés, fauteuils) et moteur d'intelligence activable
alter table clinics add column if not exists open_time text not null default '08:00', add column if not exists close_time text not null default '17:00',
  add column if not exists work_days text not null default '1,2,3,4,5,6', add column if not exists chairs int not null default 2,
  add column if not exists intel_enabled boolean not null default true, add column if not exists intel_since timestamptz default now();
-- Résultats du moteur (un par analyse, recalculés en arrière-plan) et mesures quotidiennes pour comparer avant / après
create table if not exists intel_results(clinic_id uuid not null references clinics(id), kind text not null, data jsonb not null, computed_at timestamptz not null default now(), ms int, primary key (clinic_id, kind));
create table if not exists intel_metrics(clinic_id uuid not null references clinics(id), day date not null, avg_wait numeric, p90_wait numeric, waits int, no_show_rate numeric, utilization numeric, idle_min numeric, overrun numeric, primary key (clinic_id, day));
