#!/bin/bash
# ==============================================
# 🚀 Déploiement automatique vers le VPS
# pour ton projet STI2D Fiber (React/Three.js)
# ==============================================

# --- Variables à adapter ---
USER=debian
HOST=vps.latelier22.fr
DEST_PATH=/var/www/sti2d/fiber
LOCAL_BUILD=build   # ou "build" selon ton framework

echo "⚙️  Construction du projet avec pnpm..."
# pnpm install
pnpm build

echo "🧹 Nettoyage du dossier distant..."
ssh $USER@$HOST "rm -rf $DEST_PATH/*"

echo "📦 Envoi des fichiers..."
rsync -avz --delete $LOCAL_BUILD/ $USER@$HOST:$DEST_PATH/

echo "✅ Déploiement terminé sur $HOST:$DEST_PATH"
