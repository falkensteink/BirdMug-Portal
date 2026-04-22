FROM node:20-alpine
RUN apk add --no-cache docker-cli
RUN addgroup -S app && adduser -S app -G app -D -h /app
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY json-logger.js ./
COPY public ./public
RUN chown -R app:app /app
USER app
ENV NODE_ENV=production
EXPOSE 3080
CMD ["node", "server.js"]
