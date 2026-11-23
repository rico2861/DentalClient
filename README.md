> ℹ️ **Déploiement** : la copie déployée (service unique Render) vit dans `BackendDental/clinic/`.
> Les deux sont tenues synchronisées ; privilégier `BackendDental/clinic/` comme référence pour le déploiement.

# DENTAL — Édition Web (DentalClient)

Version **web** du logiciel de gestion de cabinet dentaire DENTAL : même application,
mêmes fonctions, accessible **par Internet** depuis un navigateur. L'app installée
(dépôt `Dental`) et cette édition web partagent le même code.

## Connexion
Accès protégé par **licence + code OTP** :
1. Ouvrez l'URL du service → saisissez votre **clé de licence**.
2. Un **code à 6 chiffres** est envoyé à l'e-mail de votre inscription (valable 10 min).
3. Saisissez le code → accès. Ensuite, connexion habituelle des utilisateurs du cabinet.

## Sécurité & isolation des données
- Toutes les routes exigent une **authentification** et des **permissions** (rôles).
- Chaque requête est **cantonnée à la clinique** de l'utilisateur connecté (`clinic_id`) ;
  un utilisateur ne voit que les données auxquelles ses droits donnent accès
  (ex. patients assignés, finances, etc.).
- Données **chiffrées** (AES-256) ; journal d'audit ; double authentification possible.

## Impression (reçus & factures)
- **Facture PDF** : bouton « PDF » dans Finances → s'ouvre dans le navigateur, prêt à imprimer.
- **Reçu de paiement PDF** : bouton « Reçus » → impression via le navigateur (toute imprimante).

## Déploiement (Render + Docker)
1. Render → New + → **Blueprint** → connectez ce dépôt (lit `render.yaml`).
2. Renseignez `SAAS_URL` (= URL du backend SaaS BackendDental) et `OWNER_PASSWORD`.
3. `JWT_SECRET` est généré et stable ; les données persistent sur le volume `/data`.

> Édition **mono-clinique** par déploiement (sous-étape 1). Le mode **multi-cliniques
> partagé** (une instance pour plusieurs cabinets, isolation par `clinic_id`) est la
> sous-étape suivante.
