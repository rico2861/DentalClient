# ═══ DENTAL — version web (conteneur) ═══════════════════════════════════════
# La même application, hébergée en ligne et accessible par navigateur.
FROM node:20-slim
WORKDIR /app

# Dépendances (production)
COPY backend/package*.json backend/
RUN cd backend && npm install --omit=dev --no-audit --no-fund

# Code
COPY . .

# Données persistantes (base, documents, sauvegardes, .env) dans un volume
ENV NODE_ENV=production PORT=3000 DATA_ROOT=/data
VOLUME /data
EXPOSE 3000

# JWT_SECRET doit être fourni en variable d'environnement (chiffre les données + sessions).
CMD ["node","backend/src/server.js"]
