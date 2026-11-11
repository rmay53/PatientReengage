# Single image for the app. Includes the Prisma CLI and tsx so migrations and
# the seed script can run inside the container.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && apt-get clean
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npx next build && chown -R node:node /app/.next

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
USER node
# Apply checked-in migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start"]
