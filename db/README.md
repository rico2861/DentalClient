# Base de données (PostgreSQL embarqué via PGlite)

Les migrations SQL sont dans `migrations/`, nommées `NNN_description.sql` et appliquées **dans l'ordre, une seule fois chacune**.
L'historique est tenu dans la table `schema_migrations`.

| Fichier | Contenu |
|---|---|
| `001_core.sql` | Cliniques, utilisateurs, permissions, taux de change, journal d'audit, patients |
| `002_billing.sql` | Factures, paiements, employés, paie |
| `003_operations.sql` | Dossier médical, dents, stock, achats, caisse, dépenses |
| `004_planning.sql` | Rendez-vous, rappels, plans de traitement, prothèses, laboratoires |
| `005_documents.sql` | Documents patients, consentements |
| `006_security.sql` | 2FA, sessions, historique de connexion, notifications, examens, demandes d'achat |
| `007_patient_file_numbers.sql` | N° de dossier patient unique et aléatoire (auto) |
| `008_dossier.sql` | N° de dossier simple (DL-123456), dossiers désactivés jamais supprimés, dents temporaires, champs de la fiche |

## Commandes (depuis `backend/`)

```bash
npm run setup     # 1re installation : migrations + clinique + compte propriétaire
npm run migrate   # mises à jour : applique uniquement les migrations en attente
```

## Ajouter une migration

Créez `007_ma_modification.sql` (numéro suivant). Écrivez-la de façon **idempotente**
(`create table if not exists`, `add column if not exists`…) et ne modifiez **jamais** un fichier déjà appliqué en production.

Les tables d'audit, d'historique de connexion et de taux de change sont protégées par des triggers (aucune modification ni suppression).
