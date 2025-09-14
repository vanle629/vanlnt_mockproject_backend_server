FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["node", "index.js"]
