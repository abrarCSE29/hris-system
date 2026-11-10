FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install first (this step is cached until the dependencies change). The postinstall step needs the schema.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 4000
# Applies the database changes, fills an empty database with demo data, then starts the server.
CMD ["npm", "run", "docker:start"]
