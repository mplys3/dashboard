FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev

COPY app ./app
COPY server.js ./

ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
