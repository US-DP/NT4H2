# Imagen del engine-runner (Express + motor determinista).
#
# Los paquetes @nt4h/* del workspace exponen `main: ./src/index.ts`
# (TypeScript fuente, no build a dist), así que el runtime va con tsx —
# `pnpm build` solo produce dist/ para server.ts y node no podría
# cargar el motor.
#
# Build (desde la RAÍZ del monorepo — el contexto incluye packages/):
#   docker build -f apps/engine-runner/Dockerfile -t nt4h-engine-runner .
# Run:
#   docker run -p 3001:3001 -e ENGINE_RUNNER_TOKEN=$TOKEN nt4h-engine-runner
# Persistencia opt-in de salas:
#   docker run -e ENGINE_RUNNER_STATE_DIR=/state -v nt4h-state:/state ...
FROM node:26-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# patchedDependencies (expo-image) referencia ./patches — sin este COPY
# `pnpm install --frozen-lockfile` falla al resolver el parche (I-1).
COPY patches ./patches
COPY packages ./packages
COPY apps/engine-runner ./apps/engine-runner

# Instalación completa del workspace: tsx (devDep del runner) es el
# runtime, y el lockfile trae las workspace deps @nt4h/* ya resueltas.
RUN pnpm install --frozen-lockfile

WORKDIR /app/apps/engine-runner
ENV NODE_ENV=production \
    ENGINE_RUNNER_PORT=3001
EXPOSE 3001

# I-2: no correr como root. El usuario `node` existe en la imagen base;
# el volumen de snapshots (ENGINE_RUNNER_STATE_DIR) debe montarse con
# permisos para él (docker run --user no aplica a volúmenes nombrados,
# así que el chown solo cubre el default local).
RUN mkdir -p /app/apps/engine-runner/.state && chown -R node:node /app
USER node

# /health responde sin auth — listo para liveness probe.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ENGINE_RUNNER_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "exec", "tsx", "server.ts"]
