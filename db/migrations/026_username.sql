-- Nom d'utilisateur : identifiant court et unique (initiales + 6 chiffres, ex. JP620012), utilisable pour se connecter
-- à la place de l'adresse e-mail. Les comptes existants en reçoivent un automatiquement au démarrage du serveur.
alter table users add column if not exists username text;
create unique index if not exists users_username_uq on users (upper(username)) where username is not null;
