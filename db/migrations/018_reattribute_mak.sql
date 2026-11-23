-- Migration neutralisée.
-- Elle contenait une correction de données ponctuelle propre à une clinique
-- (identifiants internes et nom réels). Retirée pour ne pas exposer de données
-- personnelles dans le dépôt. Sans effet : déjà appliquée là où elle le devait,
-- sans objet sur toute autre base. Le fichier est conservé pour garder la
-- numérotation des migrations intacte.
select 1;
