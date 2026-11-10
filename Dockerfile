# Oficina virtual Intelekia: backend Node (API + agentes) que también sirve el frontend 3D.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    TZ=America/Monterrey \
    PORT=3000 \
    WHATSAPP_WEBHOOK_PORT=3100

# tzdata para la hora de Durango; ca-certificates para HTTPS (OpenAI, Meta, GitHub…).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias primero (aprovecha la caché de Docker).
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

# Código, frontend, roles de los departamentos y contexto de negocio.
COPY . .

# Copias "de fábrica" para sembrar los volúmenes la primera vez (están vacíos al crearlos).
RUN mkdir -p /app/seed \
 && cp -r /app/departamentos /app/seed/departamentos \
 && cp -r /app/backend/state /app/seed/state \
 && sed -i 's/\r$//' /app/docker-entrypoint.sh \
 && chmod +x /app/docker-entrypoint.sh

# 3000 = oficina (con usuario y contraseña) · 3100 = webhook de WhatsApp (solo Meta)
EXPOSE 3000 3100

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "backend/server.js"]
