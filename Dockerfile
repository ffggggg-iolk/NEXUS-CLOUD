FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev && apk del python3 make g++
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm","start"]
