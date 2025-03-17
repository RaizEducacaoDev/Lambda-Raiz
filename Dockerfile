FROM node:lts-alpine
WORKDIR /app
COPY package*.json ./
COPY .env .
RUN npm install --legacy-peer-deps
COPY . .
RUN npx tsc
CMD ["npx", "serverless", "offline"]