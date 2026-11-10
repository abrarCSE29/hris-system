FROM node:24-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Where the website forwards /api calls. It is fixed when the site is built.
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
