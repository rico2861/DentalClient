-- Numéro de téléphone du compte utilisateur (modifiable par l'utilisateur dans « Mon profil »).
alter table users add column if not exists phone text;
