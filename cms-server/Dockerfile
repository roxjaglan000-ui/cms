FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY tools ./tools
ENV NODE_ENV=production
EXPOSE 8080 1883
USER node
CMD ["node", "src/index.js"]
