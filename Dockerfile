FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ src/
# the browser modules under public/ are not compiled, but src/markdown.test.ts
# imports one of them for its types, so tsc needs them present to type-check
COPY public/ public/
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist/ dist/
COPY public/ public/

USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
