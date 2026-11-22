-- Double authentification : plus jamais imposée après une récupération de compte (choix de la clinique).
-- Elle reste disponible dans le profil, et obligatoire pour les administrateurs seulement si la clinique l'active (réglages de sécurité).
update users set must_setup_2fa = false where must_setup_2fa;
