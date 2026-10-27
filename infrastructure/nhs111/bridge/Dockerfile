FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

# Non-root user for security
RUN addgroup -g 1001 -S bridge && \
    adduser -S bridge -u 1001 -G bridge
USER bridge

CMD ["node", "index.js"]
