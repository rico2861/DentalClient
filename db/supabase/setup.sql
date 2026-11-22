-- ═══ DENTAL : préparation de Supabase (à exécuter UNE FOIS) ═══
-- Supabase → SQL Editor → New query → coller ce script → Run.
-- Crée les tables qui reçoivent la copie de la clinique quand la synchronisation passe par le web (HTTPS, port 443).
-- Sécurité : Row Level Security activée SANS aucune politique → seules la clé service_role (le serveur de la clinique)
-- et le tableau de bord Supabase y ont accès ; la clé publique « anon » ne voit rien.

-- 1. Une ligne par enregistrement de la clinique (toutes les tables : patients, actes, factures, paie, stock, journal…)
create table if not exists public.dl_rows (
  tbl        text        not null,                 -- nom de la table d'origine (patients, invoices, …)
  pk         text        not null,                 -- clé primaire d'origine
  data       jsonb       not null,                 -- l'enregistrement complet
  hash       text,                                 -- empreinte : seules les lignes modifiées sont renvoyées
  updated_at timestamptz not null default now(),
  primary key (tbl, pk)
);
create index if not exists dl_rows_tbl on public.dl_rows (tbl);
alter table public.dl_rows enable row level security;

-- 2. État de la dernière synchronisation
create table if not exists public.dl_sync (
  clinic    text primary key,
  last_sync timestamptz,
  tables    int,
  rows      bigint,
  via       text
);
alter table public.dl_sync enable row level security;

-- 3. Vues lisibles pour consulter les données facilement dans Supabase (Table Editor → schéma public → Views)
create or replace view public.dl_patients with (security_invoker = true) as
  select data->>'file_number' as dossier, data->>'last_name' as nom, data->>'first_name' as prenom, data->>'phone' as telephone,
         data->>'sex' as sexe, (data->>'birth_date') as naissance, data->>'status' as statut, updated_at
  from public.dl_rows where tbl = 'patients';
create or replace view public.dl_factures with (security_invoker = true) as
  select data->>'number' as numero, data->>'kind' as type, data->>'status' as statut, (data->>'total')::numeric as total,
         data->>'currency' as devise, (data->>'created_at') as date, updated_at
  from public.dl_rows where tbl = 'invoices';
create or replace view public.dl_paiements with (security_invoker = true) as
  select data->>'receipt_number' as recu, (data->>'amount_htg')::numeric as montant_htg, data->>'method' as mode,
         data->>'reference' as reference, (data->>'created_at') as date, updated_at
  from public.dl_rows where tbl = 'payments';
create or replace view public.dl_resume with (security_invoker = true) as
  select tbl as table_origine, count(*) as lignes, max(updated_at) as derniere_mise_a_jour from public.dl_rows group by tbl order by tbl;

-- Les documents, radiographies et sauvegardes complètes sont envoyés dans le stockage Supabase
-- (Storage → bucket privé « dental-light », créé automatiquement par l'application).
