-- Récupération des comptes administrateurs (Super Admin Recovery System)
--  1. réinitialisation par e-mail : lien temporaire (30 min), usage unique, seul le condensat du jeton est conservé
--  2. codes de récupération hors ligne (table recovery_codes existante), invalidés après usage
--  3. commande en console (npm run recuperation) : aucune route Internet
--  + compte propriétaire de SECOURS : désactivé tant qu'il n'est pas activé en console, pour 24 h au plus
create table if not exists password_resets(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text);
create index if not exists password_resets_user on password_resets(user_id, created_at desc);
alter table users add column if not exists must_setup_2fa boolean not null default false;   -- double authentification imposée après une récupération
alter table users add column if not exists is_emergency boolean not null default false;     -- compte de secours
alter table users add column if not exists emergency_until timestamptz;                     -- fin de l'activation du compte de secours
alter table recovery_codes add column if not exists created_at timestamptz default now();
