# DentalClient — Frontend web (Dental Assist)

Frontend **seul** de l'application clinique Dental Assist. Déployé sur **Vercel**.
Le backend n'est **pas** dans ce dépôt : il vit dans **rico2861/BackendDental** (Render).

## Fonctionnement
- Les fichiers statiques (`index.html`, `js/`, `css/`) sont servis par Vercel.
- `vercel.json` **proxie** les appels API vers BackendDental, pour que tout soit
  en **même origine** côté navigateur (les cookies de session fonctionnent) :
  - `/api/*`  → logiciel clinique (BackendDental)
  - `/saas/*` → cerveau SaaS (licences, paiements, provisioning)

## À configurer
Dans `vercel.json`, remplace `https://backenddental.onrender.com` par l'URL réelle
de ton service **BackendDental** sur Render (les deux lignes).

Visiteur → page d'accueil publique (présentation, créer un compte, payer) →
connexion clinique (propriétaire licence+OTP / personnel mot de passe).
